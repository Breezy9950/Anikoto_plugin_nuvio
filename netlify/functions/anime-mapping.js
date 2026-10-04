const{getStore}=require("@netlify/blobs");
const STORE_NAME="anime-resolution-cache";
const INDEX_KEY="_shinkro_index";
const TMDB_TVDB_PREFIX="_tmdb_tvdb_";
const MAX_ID_LENGTH=50;
const MAX_EPISODE=100000;
const TMDB_API_KEY=process.env.TMDB_API_KEY||"68e094699525b18a70bab2f86b1fa706";
const TMDB_TIMEOUT=5000;
const TVDB_CACHE_TTL=7*24*60*60*1000;
function log(message){console.log(`[ANIME MAPPING] ${message}`);}
function json(statusCode,body){
return{
statusCode,
headers:{
"Content-Type":"application/json",
"Cache-Control":"no-store",
"Access-Control-Allow-Origin":"*",
"Access-Control-Allow-Methods":"GET,OPTIONS",
"Access-Control-Allow-Headers":"Content-Type"
},
body:JSON.stringify(body)
};
}
function parsePositiveInt(value){
const n=Number(value);
return Number.isInteger(n)&&n>0&&n<=MAX_EPISODE?n:null;
}
function fetchWithTimeout(url,options={},timeoutMs=TMDB_TIMEOUT){
const timer={id:null};
const timeout=new Promise((_,reject)=>{timer.id=setTimeout(()=>reject(new Error("Timeout")),timeoutMs);});
return Promise.race([fetch(url,options),timeout]).finally(()=>{if(timer.id!==null)clearTimeout(timer.id);});
}
async function getTmdbTvdbId(tmdbId,store){
const key=`${TMDB_TVDB_PREFIX}${tmdbId}`;
try{
const cached=await store.get(key,{type:"json",consistency:"strong"});
if(cached&&cached.updatedAt&&Date.now()-Number(cached.updatedAt)<TVDB_CACHE_TTL)return cached.tvdbId?String(cached.tvdbId):null;
}catch(error){log(`TMDB cache read failed: ${error.message}`);}
try{
const url=`https://api.themoviedb.org/3/tv/${encodeURIComponent(tmdbId)}/external_ids?api_key=${encodeURIComponent(TMDB_API_KEY)}`;
const response=await fetchWithTimeout(url,{headers:{"Accept":"application/json","User-Agent":"Breezy-Plugins-AniZone/1.0"}});
if(!response.ok){
log(`TMDB external_ids HTTP ${response.status}`);
return null;
}
const data=await response.json();
const tvdbId=data&&data.tvdb_id?String(data.tvdb_id):null;
try{
await store.setJSON(key,{tvdbId,updatedAt:Date.now()});
}catch(error){
log(`TMDB cache write failed: ${error.message}`);
}
return tvdbId;
}catch(error){
log(`TMDB external_ids failed: ${error.message}`);
return null;
}
}
function mapRange(mapping,episode){
let start=Number(mapping.start);
if(!Number.isFinite(start)||start<1)start=1;
let target=start+episode-1;
const skips=[...new Set((mapping.skipMalEpisodes||[]).map(Number).filter(Number.isInteger))].sort((a,b)=>a-b);
for(const skip of skips){
if(skip<=target)target++;
else break;
}
return target;
}
function mapCandidate(candidate,season,episode){
if(candidate.useMapping){
const mappings=Array.isArray(candidate.animeMapping)?candidate.animeMapping:[];
const mapping=mappings.find(item=>Number(item.tvdbseason)===season);
if(!mapping)return null;
if(mapping.mappingType==="explicit"){
const explicit=mapping.explicitEpisodes||{};
const direct=explicit[episode]??explicit[String(episode)];
const target=Number(direct);
if(!Number.isInteger(target)||target<1)return null;
return target;
}
return mapRange(mapping,episode);
}
if(Number(candidate.tvdbseason)!==season)return null;
const start=Number(candidate.start)||0;
if(episode<start&&start>0)return null;
return start>0?episode-start+1:episode;
}
function chooseMapping(candidates,season,episode){
if(!Array.isArray(candidates))return null;
const usable=candidates.filter(candidate=>candidate&&candidate.malid);
const mapped=[];
for(const candidate of usable){
const targetEpisode=mapCandidate(candidate,season,episode);
if(!Number.isInteger(targetEpisode)||targetEpisode<1)continue;
mapped.push({candidate,targetEpisode});
}
if(!mapped.length)return null;
mapped.sort((a,b)=>{
const am=a.candidate.useMapping?1:0;
const bm=b.candidate.useMapping?1:0;
if(am!==bm)return bm-am;
const as=Number(a.candidate.start)||0;
const bs=Number(b.candidate.start)||0;
if(as!==bs)return bs-as;
return Number(a.candidate.malid)-Number(b.candidate.malid);
});
const selected=mapped[0];
const c=selected.candidate;
const seasonMapping=c.useMapping?c.animeMapping.find(x=>Number(x.tvdbseason)===season):null;
return{
tmdb_id:null,
tvdb_id:null,
tvdb_season:season,
mal_id:String(c.malid),
mal_episode:selected.targetEpisode,
target_episode:selected.targetEpisode,
anime_title:c.title||"",
titles:c.title?[c.title]:[],
air_date:"",
source:"shinkro",
shinkro:{
useMapping:!!c.useMapping,
start:Number(c.start)||0,
mappingType:seasonMapping&&seasonMapping.mappingType||"range"
}
};
}
exports.handler=async event=>{
const started=Date.now();
try{
const method=(event.httpMethod||"GET").toUpperCase();
if(method==="OPTIONS")return json(204,{});
if(method!=="GET")return json(405,{ok:false,error:"Method not allowed"});
const params=event.queryStringParameters||{};
const tmdbId=String(params.tmdbId||"").trim();
const season=parsePositiveInt(params.season);
const episode=parsePositiveInt(params.episode);
if(!/^\d+$/.test(tmdbId)||tmdbId.length>MAX_ID_LENGTH||!season||!episode){
return json(400,{ok:false,error:"tmdbId, season and episode are required"});
}
const store=getStore({
  name:STORE_NAME,
  siteID:process.env.NETLIFY_SITE_ID,
  token:process.env.NETLIFY_AUTH_TOKEN
});
const index=await store.get(INDEX_KEY,{type:"json",consistency:"strong"});
if(!index||!index.byTvdb||typeof index.byTvdb!=="object"){
return json(503,{ok:false,error:"Shinkro mapping index is not available"});
}
const tvdbId=await getTmdbTvdbId(tmdbId,store);
if(!tvdbId){
log(`TMDB->TVDB MISS TMDB=${tmdbId}`);
return json(404,{ok:false,mapping:null,error:"TMDB to TVDB mapping not found"});
}
const candidates=index.byTvdb[tvdbId];
if(!Array.isArray(candidates)||!candidates.length){
log(`SHINKRO TVDB MISS TVDB=${tvdbId}`);
return json(404,{ok:false,mapping:null,error:"Shinkro mapping not found"});
}
const mapping=chooseMapping(candidates,season,episode);
if(!mapping){
log(`SHINKRO EPISODE MISS TMDB=${tmdbId} TVDB=${tvdbId} S${season}E${episode}`);
return json(404,{ok:false,mapping:null,error:"Shinkro episode mapping not found"});
}
mapping.tmdb_id=tmdbId;
mapping.tvdb_id=tvdbId;
log(`MAPPING HIT TMDB=${tmdbId} TVDB=${tvdbId} S${season}E${episode} -> MAL=${mapping.mal_id} E${mapping.mal_episode} title=${mapping.anime_title||"?"} time=${Date.now()-started}ms`);
return json(200,{ok:true,source:"shinkro",updatedAt:index.updatedAt||null,mapping});
}catch(error){
console.error(`[ANIME MAPPING] FATAL after ${Date.now()-started}ms`,error);
return json(500,{ok:false,error:error&&error.message?error.message:"Mapping service error"});
}
};
