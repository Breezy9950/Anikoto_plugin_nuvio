const{getStore}=require("@netlify/blobs");
const STORE="anime-resolution-cache",LEGACY_LAZY_STORE="anime-lazy-resolution",TVDB_PREFIX="_shinkro:tvdb:",INDEX_KEY="_shinkro_index",MANIFEST_KEY="_shinkro:manifest",TMDB_TVDB_PREFIX="_tmdb_tvdb_",MAX_ID=50,MAX_EP=100000,MAX_WINDOW=12,LOCK_TTL=2*60*1000,TIMEOUT=4000,CONCURRENCY=4,TMDB_KEY=process.env.TMDB_API_KEY||"68e094699525b18a70bab2f86b1fa706";
const MAX_MAPPING_WAIT=4500,MAPPING_POLL_MS=300;

function log(x){console.log(`[ANIME LAZY MAPPING] ${x}`)}
function json(status,body){return{statusCode:status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type"},body:JSON.stringify(body)}}
function num(v,max=MAX_EP){const n=Number(v);return Number.isInteger(n)&&n>=0&&n<=max?n:null}
function pos(v){const n=num(v);return n&&n>0?n:null}
function db(){return getStore({name:STORE,siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN})}
function legacyDb(){return getStore({name:LEGACY_LAZY_STORE,siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN})}

async function limitConcurrency(tasks, limit) {
  const results = [];
  const executing = [];
  for (const task of tasks) {
    const p = Promise.resolve().then(() => task());
    results.push(p);
    if (limit <= tasks.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

async function fetchJson(url,timeout=TIMEOUT){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{headers:{Accept:"application/json","User-Agent":"Anikoto-Nuvio-Lazy/1.0"},signal:c.signal});if(!r.ok){log(`HTTP ${r.status} ${url.split("?")[0]}`);return{state:r.status===429?"RATE_LIMITED":"HTTP_ERROR",data:null}}try{return{state:"HIT",data:await r.json()}}catch(e){return{state:"MALFORMED",data:null}}}catch(e){const m=String(e&&e.message||e);return{state:/abort|timeout/i.test(m)?"TIMEOUT":"UNKNOWN",data:null}}finally{clearTimeout(t)}}
function day(v){const s=v?String(v).split("T")[0]:"";return/^\d{4}-\d\d-\d\d$/.test(s)?s:""}
function dateMatch(a,b){a=day(a);b=day(b);if(!a||!b)return false;return Math.abs(new Date(a+"T00:00:00Z")-new Date(b+"T00:00:00Z"))<=2*86400000}
function uniq(a){return[...new Set((a||[]).filter(Boolean).map(String))]}
function titles(a){return uniq(a).slice(0,50)}
function normTitle(v){const s=String(v||"").toLowerCase();try{return s.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"")}catch(e){return s.replace(/[^a-z0-9]/g,"")}}
function titleMatch(a,b){a=normTitle(a);b=normTitle(b);return!!a&&!!b&&(a===b||a.includes(b)||b.includes(a))}
async function tmdb(id,path=""){return(await fetchJson(`https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}${path}${path.includes("?")?"&":"?"}api_key=${encodeURIComponent(TMDB_KEY)}`,4000)).data}
async function external(id){return(await fetchJson(`https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}/external_ids?api_key=${encodeURIComponent(TMDB_KEY)}`,4000)).data}
async function tmdbSeason(id,s){return(await fetchJson(`https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}/season/${encodeURIComponent(s)}?api_key=${encodeURIComponent(TMDB_KEY)}`,4000)).data}
async function tmdbEpisode(id,s,e){return(await fetchJson(`https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}/season/${encodeURIComponent(s)}/episode/${encodeURIComponent(e)}?api_key=${encodeURIComponent(TMDB_KEY)}`,4000)).data}
async function tmdbEpisodeExternal(id,s,e){return(await fetchJson(`https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}/season/${encodeURIComponent(s)}/episode/${encodeURIComponent(e)}/external_ids?api_key=${encodeURIComponent(TMDB_KEY)}`,4000)).data}
async function arm(id,imdb,tvdb){const urls=[imdb&&`https://arm.haglund.dev/api/v2/imdb?id=${encodeURIComponent(imdb)}`,id&&`https://arm.haglund.dev/api/v2/themoviedb?id=${encodeURIComponent(id)}`,tvdb&&`https://arm.haglund.dev/api/v2/thetvdb?id=${encodeURIComponent(tvdb)}`].filter(Boolean);const rs=await Promise.all(urls.map(u=>fetchJson(u,3500)));const ids=[],states=[];for(const r of rs){states.push(r.state);if(r.state==="HIT"&&Array.isArray(r.data))for(const x of r.data)if(x&&x.myanimelist)ids.push(String(x.myanimelist))}return{ids:uniq(ids),states}}
async function aniTmdb(id,imdb){return(await fetchJson(id?`https://api.ani.zip/mappings?themoviedb_id=${encodeURIComponent(id)}`:`https://api.ani.zip/mappings?imdb_id=${encodeURIComponent(imdb)}`,3500)).data}
async function aniTvdb(id){return(await fetchJson(`https://api.ani.zip/mappings?thetvdb_id=${encodeURIComponent(id)}`,3500)).data}
async function aniMal(mal){return(await fetchJson(`https://api.ani.zip/mappings?mal_id=${encodeURIComponent(mal)}`,3500)).data}
async function jikan(mal){return(await fetchJson(`https://api.jikan.moe/v4/anime/${encodeURIComponent(mal)}`,3500)).data}
function aniIds(x){return x&&x.mappings&&x.mappings.mal_id?[String(x.mappings.mal_id)]:[]}
function malTitleData(ani,j){const d=j&&j.data||{},raw=ani&&ani.titles&&typeof ani.titles==="object"?Object.values(ani.titles).filter(Boolean):[],english=d.title_english||null,romanji=d.title||null;return{english,romanji,all:titles([...raw,english,romanji,d.title_japanese])}}
function episodeInfo(x){if(!x)return null;return{tvdb_season:Number(x.seasonNumber),tvdb_episode:Number(x.episodeNumber),tvdb_episode_id:x.tvdbEid||x.tvdbId||null,absolute:x.absoluteEpisodeNumber!=null?Number(x.absoluteEpisodeNumber):null,air_date:day(x.airDateUtc||x.airDate||x.airdate),title:(x.title&&(x.title.en||x.title["x-jat"]||x.title.x))||""}}
function aniEpisodeList(ani){const out=[];for(const x of Object.values(ani&&ani.episodes||{})){const e=episodeInfo(x);if(e&&Number.isInteger(e.tvdb_season)&&Number.isInteger(e.tvdb_episode)&&e.tvdb_season>=0&&e.tvdb_episode>0)out.push(e)}return out}
function cinemetaEpisodeInfo(x){if(!x)return null;const season=Number(x.season),episode=Number(x.episode);if(!Number.isInteger(season)||!Number.isInteger(episode)||season<0||episode<=0)return null;return{tmdb_season:season,tmdb_episode:episode,tmdb_episode_id:x.id||x.video_id||null,air_date:day(x.released||x.air_date||x.release_date),title:x.title||x.name||""}}
async function cinemetaEpisodes(imdb){if(!imdb)return[];const urls=[`https://v3-cinemeta.strem.io/meta/series/${encodeURIComponent(imdb)}.json`,`https://cinemeta-live.strem.io/meta/series/${encodeURIComponent(imdb)}.json`];for(const url of urls){try{const r=await fetchJson(url,4000),m=r.data&&r.data.meta;if(m&&Array.isArray(m.videos)){const out=m.videos.map(cinemetaEpisodeInfo).filter(Boolean);if(out.length)return out}}catch(e){}}return[]}
async function eligibility(id,old,ext){
if(old&&old.animeEligible===true&&old.mal_id)return{ok:true,mal:old.mal_id,imdb:old.imdb_id||ext&&ext.imdb_id||null,source:"stored"};
if(old&&old.animeEligible===false&&old.animeEligibilityReason==="NO_ANIME_SOURCE")return{ok:false,temporary:false,imdb:old.imdb_id||ext&&ext.imdb_id||null,source:"NO_ANIME_SOURCE"};
const imdb=String(old&&old.imdb_id||ext&&ext.imdb_id||"")||null,states=[],candidates=[];
const[ar,az]=await Promise.all([arm(id,imdb,ext&&ext.tvdb_id),aniTmdb(id,imdb)]);
if(ar.ids.length){candidates.push(...ar.ids);states.push("HIT")}else states.push(...ar.states.length?ar.states:["MISS"]);
const azIds=aniIds(az);
if(azIds.length)candidates.push(...azIds);else states.push("MISS");
if(ar.ids.length){states.push("SKIPPED_ARM_HIT");log(`ELIGIBILITY MAL=HIT ARM=HIT JIKAN=SKIPPED -> ANIME CONFIRMED`);return{ok:true,mal:ar.ids[0],imdb,source:"ARM"}}
let mal=null,jikanState="MISS";
const jikCands=uniq(candidates).slice(0,3);
if(jikCands.length){
const rs=await limitConcurrency(jikCands.map(m=>async()=>jikan(m)),2);
for(const r of rs){if(r&&r.data&&r.data.mal_id){mal=String(r.data.mal_id);jikanState="HIT";break}if(r===null)jikanState="HTTP_ERROR"}
}
states.push(jikanState);
if(mal){log(`ELIGIBILITY MAL=HIT ARM=MISS JIKAN=HIT -> ANIME CONFIRMED`);return{ok:true,mal,imdb,source:"JIKAN"}}
const genuine=states.filter(x=>x==="MISS").length===states.length;
log(`ELIGIBILITY MAL=MISS ARM=MISS JIKAN=${jikanState} -> ${genuine?"NO_ANIME_SOURCE":"TEMPORARY_SOURCE_FAILURE"}`);
return{ok:false,temporary:!genuine,imdb,source:genuine?"NO_ANIME_SOURCE":"TEMPORARY_SOURCE_FAILURE"}
}
async function readSeries(s,id){const x=await s.get(`anime:${id}`,{type:"json",consistency:"eventual"});return x&&typeof x==="object"?x:null}
async function readSeason(s,id,n){const x=await s.get(`anime:${id}:season:${n}`,{type:"json",consistency:"eventual"});return x&&typeof x==="object"?x:null}
function mapRange(mapping,episode){
let start=Number(mapping.start);
if(!Number.isFinite(start)||start<1)start=1;
let target=start+episode-1;
const skips=[...new Set((mapping.skipMalEpisodes||[]).map(Number).filter(Number.isInteger))].sort((a,b)=>a-b);
for(const skip of skips){if(skip<=target)target++;else break}
return target
}
function mapCandidate(candidate,season,episode){
if(candidate.useMapping){
const mappings=Array.isArray(candidate.animeMapping)?candidate.animeMapping:[];
const mapping=mappings.find(item=>Number(item.tvdbseason)===season);
if(!mapping)return null;
if(mapping.mappingType==="explicit"){
const explicit=mapping.explicitEpisodes||{},direct=explicit[episode]??explicit[String(episode)],target=Number(direct);
if(!Number.isInteger(target)||target<1)return null;
return target
}
return mapRange(mapping,episode)
}
if(Number(candidate.tvdbseason)!==season)return null;
const start=Number(candidate.start)||0;
if(episode<start&&start>0)return null;
return start>0?episode-start+1:episode
}
function candidateSourceRank(candidate){return candidate&&candidate.source==="lazy"?1:0}
function chooseMapping(candidates,season,episode){
if(!Array.isArray(candidates))return null;
const mapped=[];
for(const candidate of candidates){
if(!candidate||!candidate.malid)continue;
const targetEpisode=mapCandidate(candidate,season,episode);
if(!Number.isInteger(targetEpisode)||targetEpisode<1)continue;
mapped.push({candidate,targetEpisode})
}
if(!mapped.length)return null;
mapped.sort((a,b)=>{
const ar=candidateSourceRank(a.candidate),br=candidateSourceRank(b.candidate);
if(ar!==br)return ar-br;
const am=a.candidate.useMapping?1:0,bm=b.candidate.useMapping?1:0;
if(am!==bm)return bm-am;
const as=Number(a.candidate.start)||0,bs=Number(b.candidate.start)||0;
if(as!==bs)return bs-as;
return Number(a.candidate.malid)-Number(b.candidate.malid)
});
return mapped[0]
}
async function getTmdbTvdbId(tmdbId,store){
const key=`${TMDB_TVDB_PREFIX}${tmdbId}`;
try{
const cached=await store.get(key,{type:"json",consistency:"eventual"});
if(cached&&cached.updatedAt&&Date.now()-Number(cached.updatedAt)<7*24*60*60*1000)return cached.tvdbId?String(cached.tvdbId):null
}catch(error){log(`TMDB cache read failed: ${error.message}`)}
try{
const url=`https://api.themoviedb.org/3/tv/${encodeURIComponent(tmdbId)}/external_ids?api_key=${encodeURIComponent(TMDB_KEY)}`,response=await fetchJson(url,4000),data=response.data;
if(!data)return null;
const tvdbId=data&&data.tvdb_id?String(data.tvdb_id):null;
try{await store.setJSON(key,{tvdbId,updatedAt:Date.now()})}catch(error){log(`TMDB cache write failed: ${error.message}`)}
return tvdbId
}catch(error){log(`TMDB external_ids failed: ${error.message}`);return null}
}
async function loadSharedCandidates(store,tvdbId){
try{
const record=await store.get(`${TVDB_PREFIX}${tvdbId}`,{type:"json",consistency:"eventual"});
if(Array.isArray(record)&&record.length)return{candidates:record,source:"shared-tvdb"};
if(record&&Array.isArray(record.candidates)&&record.candidates.length)return{candidates:record.candidates,source:"shared-tvdb"}
}catch(error){log(`SHARED DB READ FAILED TVDB=${tvdbId} ${error.message}`)}
try{
const index=await store.get(INDEX_KEY,{type:"json",consistency:"eventual"});
if(index&&index.byTvdb&&Array.isArray(index.byTvdb[tvdbId]))return{candidates:index.byTvdb[tvdbId],source:"legacy-index"}
}catch(error){log(`LEGACY INDEX READ FAILED TVDB=${tvdbId} ${error.message}`)}
return{candidates:null,source:"none"};
}
function mappingFromCandidate(id,tvdbId,season,episode,selected){
const c=selected&&selected.candidate,m=selected&&selected.targetEpisode;
if(!c||!m)return null;
const meta=c.episodeMetadata&&c.episodeMetadata[String(episode)]||{};
const candidateTitles=Array.isArray(c.titles)?c.titles:[],allTitles=titles([c.title,...candidateTitles,...(Array.isArray(meta.titles)?meta.titles:[]),meta.mal_title]);
return{
tmdb_id:id,
imdb_id:meta.imdb_id||null,
tvdb_id:tvdbId,
mal_id:String(c.malid),
anime_title:c.title||meta.anime_title||meta.title||"",
titles:allTitles,
mal_title:meta.mal_title||null,
mal_title_english:meta.mal_title_english||null,
mal_title_romanji:meta.mal_title_romanji||null,
season:Number(season),
episode:Number(episode),
tvdb_season:Number(season),
tvdb_episode:meta.tvdb_episode!=null?Number(meta.tvdb_episode):Number(episode),
tvdb_episode_id:meta.tvdb_episode_id||null,
tmdb_season:meta.tmdb_season!=null?Number(meta.tmdb_season):Number(season),
tmdb_episode:meta.tmdb_episode!=null?Number(meta.tmdb_episode):Number(episode),
tmdb_episode_id:meta.tmdb_episode_id||null,
mal_episode:Number(m),
target_episode:Number(m),
air_date:meta.air_date||"",
episode_title:meta.episode_title||meta.title||"",
season_title:meta.season_title||"",
source:c.source==="lazy"?"lazy":"shinkro",
shinkro:{
malid:Number(c.malid),
tvdbseason:Number(c.tvdbseason),
start:Number(c.start)||0,
useMapping:!!c.useMapping,
mappingType:c.useMapping&&Array.isArray(c.animeMapping)?((c.animeMapping.find(x=>Number(x.tvdbseason)===Number(season))||{}).mappingType||"range"):"range",
explicitEpisodes:c.useMapping&&Array.isArray(c.animeMapping)?((c.animeMapping.find(x=>Number(x.tvdbseason)===Number(season))||{}).explicitEpisodes||{}):{},
skipMalEpisodes:c.useMapping&&Array.isArray(c.animeMapping)?((c.animeMapping.find(x=>Number(x.tvdbseason)===Number(season))||{}).skipMalEpisodes||[]):[]
}
}
}
async function migrateLegacyLazy(id,s,tvdbId){
try{
const legacy=legacyDb(),seasonState=await legacy.get(`anime:${id}:season:${s}`,{type:"json",consistency:"eventual"});
if(!seasonState||!seasonState.episodes||!tvdbId)return false;
const added={};
for(const [episode,old] of Object.entries(seasonState.episodes)){
if(!old||old.mal_episode==null)continue;
const ep=Number(episode);
if(!Number.isInteger(ep)||ep<1)continue;
added[episode]={
title:old.title||old.episode_title||"",
episode_title:old.episode_title||old.title||"",
air_date:old.air_date||"",
tvdb_id:old.tvdb_id||seasonState.tvdb_id||tvdbId,
tvdb_season:old.tvdb_season!=null?Number(old.tvdb_season):s,
tvdb_episode:old.tvdb_episode!=null?Number(old.tvdb_episode):ep,
tvdb_episode_id:old.tvdb_episode_id||null,
tmdb_id:id,
tmdb_season:old.tmdb_season!=null?Number(old.tmdb_season):s,
tmdb_episode:old.tmdb_episode!=null?Number(old.tmdb_episode):ep,
tmdb_episode_id:old.tmdb_episode_id||null,
mal_id:String(old.mal_id||seasonState.mal_id||""),
mal_episode:Number(old.mal_episode),
mal_title:old.mal_title||seasonState.mal_title||null,
mal_title_romanji:old.mal_title_romanji||seasonState.mal_title_romanji||null,
mal_title_english:old.mal_title_english||seasonState.mal_title_english||null,
titles:Array.isArray(old.titles)?old.titles:Array.isArray(seasonState.titles)?seasonState.titles:[],
imdb_id:seasonState.imdb_id||null
}
}
if(!Object.keys(added).length)return false;
const changed=await writeLazyMappings(String(tvdbId),added);
if(changed)log(`LEGACY LAZY MIGRATED TMDB=${id} S${s} TVDB=${tvdbId} episodes=${Object.keys(added).length}`);
return changed
}catch(error){log(`LEGACY LAZY MIGRATION FAILED TMDB=${id} S${s} ${error.message}`);return false}
}
async function sharedLookup(id,s,e,tvdbOverride){
const st=db(),tvdbId=tvdbOverride?String(tvdbOverride):await getTmdbTvdbId(id,st);
if(!tvdbId){log(`TMDB->TVDB MISS TMDB=${id}`);return null}
log(`TMDB->TVDB TMDB=${id} TVDB=${tvdbId}`);
let loaded=await loadSharedCandidates(st,tvdbId),selected=chooseMapping(loaded.candidates,s,e);
if(!selected){
const migrated=await migrateLegacyLazy(id,s,tvdbId);
if(migrated){
loaded=await loadSharedCandidates(st,tvdbId);
selected=chooseMapping(loaded.candidates,s,e);
}
}
if(!selected){log(`SHARED DB MISS TVDB=${tvdbId} S${s}E${e} source=${loaded.source}`);return null}
const mapping=mappingFromCandidate(id,tvdbId,s,e,selected);
log(`SHARED DB HIT TVDB=${tvdbId} S${s}E${e} source=${mapping.source} MAL=${mapping.mal_id} E${mapping.mal_episode}`);
return{mapping,tvdbId,candidate:selected.candidate,source:mapping.source}
}
async function lock(st,id){const k=`building:${id}`,now=Date.now(),old=await st.get(k,{type:"json",consistency:"eventual"});if(old&&Number(old.expiresAt)>now){log(`LOCK COLLISION TMDB=${id}`);return false}if(old)try{await st.delete(k)}catch(e){}const r=await st.setJSON(k,{tmdb_id:id,startedAt:now,expiresAt:now+LOCK_TTL},{onlyIfNew:true});if(r&&r.modified){log(`LOCK ACQUIRED TMDB=${id}`);return true}log(`LOCK COLLISION TMDB=${id}`);return false}
async function unlock(st,id){try{await st.delete(`building:${id}`);log(`LOCK RELEASED TMDB=${id}`)}catch(e){log(`LOCK RELEASE FAILED TMDB=${id}`)}}
function through(total,episodes){let n=0;while(n<total&&episodes&&episodes[String(n+1)]&&episodes[String(n+1)].mal_episode!=null)n++;return n}
function episodeKey(ep){return String(ep)}
function mergeLazyCandidate(list,entry){
const malId=String(entry.mal_id||"").trim(),tvdbSeason=Number(entry.tvdb_season),episode=Number(entry.tmdb_episode);
if(!malId||!Number.isInteger(tvdbSeason)||tvdbSeason<0||!Number.isInteger(episode)||episode<1)return list;
let candidate=list.find(x=>x&&x.source==="lazy"&&String(x.malid)===malId&&Number(x.tvdbseason)===tvdbSeason);
if(!candidate){
candidate={malid:Number(malId),title:entry.mal_title||entry.title||"",type:"",tvdbseason:tvdbSeason,start:0,useMapping:true,animeMapping:[{tvdbseason:tvdbSeason,start:0,mappingType:"explicit",explicitEpisodes:{},skipMalEpisodes:[]}],titles:Array.isArray(entry.titles)?entry.titles.slice(0,50):[],source:"lazy",updatedAt:Date.now(),episodeMetadata:{}};
list.push(candidate)
}
candidate.title=candidate.title||entry.mal_title||entry.title||"";
candidate.titles=titles([...(candidate.titles||[]),...(entry.titles||[]),entry.mal_title]);
candidate.updatedAt=Date.now();
const am=candidate.animeMapping[0]||{tvdbseason:tvdbSeason,start:0,mappingType:"explicit",explicitEpisodes:{},skipMalEpisodes:[]};
am.explicitEpisodes=am.explicitEpisodes||{};
am.explicitEpisodes[episode]=Number(entry.mal_episode);
candidate.animeMapping=[am];
candidate.episodeMetadata=candidate.episodeMetadata||{};
candidate.episodeMetadata[episode]={
title:entry.title||"",
episode_title:entry.episode_title||entry.title||"",
air_date:entry.air_date||"",
tvdb_id:entry.tvdb_id||null,
tvdb_season:entry.tvdb_season,
tvdb_episode:entry.tvdb_episode,
tvdb_episode_id:entry.tvdb_episode_id||null,
tmdb_id:entry.tmdb_id||null,
tmdb_season:entry.tmdb_season,
tmdb_episode:entry.tmdb_episode,
tmdb_episode_id:entry.tmdb_episode_id||null,
mal_title:entry.mal_title||null,
mal_title_english:entry.mal_title_english||null,
mal_title_romanji:entry.mal_title_romanji||null,
titles:Array.isArray(entry.titles)?entry.titles.slice(0,50):[],
imdb_id:entry.imdb_id||null,
};
return list
}
async function writeLazyMappings(tvdbId,added){
if(!tvdbId||!added||!Object.keys(added).length)return false;
const st=db(),lockKey=`_shared_mapping_lock:${tvdbId}`;
for(let attempt=0;attempt<10;attempt++){
const oldLock=await st.get(lockKey,{type:"json",consistency:"eventual"}).catch(()=>null);
if(oldLock&&Number(oldLock.expiresAt)>Date.now()){
await new Promise(r=>setTimeout(r,50*Math.pow(2,attempt)));
continue;
}
if(oldLock)await st.delete(lockKey).catch(()=>{});
const lock=await st.setJSON(lockKey,{startedAt:Date.now(),expiresAt:Date.now()+30_000},{onlyIfNew:true}).catch(()=>null);
if(!lock||!lock.modified){
await new Promise(r=>setTimeout(r,50*Math.pow(2,attempt)));
continue;
}
try{
const loaded=await loadSharedCandidates(st,String(tvdbId)),list=Array.isArray(loaded.candidates)?loaded.candidates.map(x=>x):[];
let changed=false;
for(const entry of Object.values(added)){
const existing=chooseMapping(list,Number(entry.tmdb_season),Number(entry.tmdb_episode));
if(existing&&existing.candidate&&existing.candidate.source!=="lazy"){
log(`SHARED WRITE SKIP SHINKRO EXISTS TVDB=${tvdbId} S${entry.tmdb_season}E${entry.tmdb_episode}`);
continue
}
const before=JSON.stringify(list);
mergeLazyCandidate(list,entry);
if(before!==JSON.stringify(list))changed=true
}
if(changed){await st.setJSON(`${TVDB_PREFIX}${tvdbId}`,list);log(`SHARED DB WRITE TVDB=${tvdbId} lazyEntries=${Object.keys(added).length}`)}
return changed
}finally{await st.delete(lockKey).catch(()=>{})}
}
return false
}

function bestTvdbEpisode(list,s,e){return list.find(x=>x.tvdb_season===s&&x.tvdb_episode===e)||null}
function bestTmdbEpisode(episodes,target){if(!target)return null;const exactDate=target.air_date?episodes.filter(x=>dateMatch(x.air_date,target.air_date)):[];if(exactDate.length===1)return exactDate[0];if(exactDate.length){const title=exactDate.find(x=>titleMatch(x.title,target.title));if(title)return title;return exactDate[0]}if(target.title){const title=episodes.find(x=>titleMatch(x.title,target.title));if(title)return title}return null}
function bestTvdbByTmdbEpisode(list,target){
if(!target||!list.length)return null;
if(target.air_date){
const dated=list.filter(x=>dateMatch(x.air_date,target.air_date));
if(dated.length===1)return dated[0];
if(dated.length>1&&target.title){const titled=dated.find(x=>titleMatch(x.title,target.title));if(titled)return titled}
if(dated.length)return dated[0]
}
if(target.title){
const titled=list.filter(x=>titleMatch(x.title,target.title));
if(titled.length===1)return titled[0];
if(titled.length>1){
const exact=titled.find(x=>normTitle(x.title)===normTitle(target.title));
if(exact)return exact;
return titled[0]
}
}
return null
}
function episodeFromSeason(id,s,season){
const out=[];for(const x of season&&Array.isArray(season.episodes)?season.episodes:[])out.push({tmdb_season:Number(x.season_number!=null?x.season_number:s),tmdb_episode:Number(x.episode_number),tmdb_episode_id:x.id||null,air_date:day(x.air_date),title:x.name||""});return out}
function exactCanonicalEpisode(tmdbEpisodes,cinemetaEpisodes,s,e){
const tm=tmdbEpisodes.find(x=>x.tmdb_season===s&&x.tmdb_episode===e);
if(tm)return Object.assign({},tm,{canonical:"tmdb"});
const cm=cinemetaEpisodes.find(x=>x.tmdb_season===s&&x.tmdb_episode===e);
if(cm)return Object.assign({},cm,{canonical:"cinemeta"});
return null
}
async function resolveTvdbEpisode(id,s,e,tvdbEpisodes,tmdbEpisodes,cinemetaEpisodeList,cache){
const key=`${s}:${e}`,cached=cache&&cache.get(key);if(cached)return cached;
const tmdbEpisode=exactCanonicalEpisode(tmdbEpisodes,cinemetaEpisodeList,s,e);
if(!tmdbEpisode){const r={tvdb:null,tmdb:null,match:"none"};if(cache)cache.set(key,r);return r}
const direct=bestTvdbEpisode(tvdbEpisodes,s,e);
if(direct){
if((direct.air_date&&tmdbEpisode.air_date&&dateMatch(direct.air_date,tmdbEpisode.air_date))||(direct.title&&titleMatch(direct.title,tmdbEpisode.title))){
const r={tvdb:direct,tmdb:tmdbEpisode,match:"tvdb_s_e_verified"};if(cache)cache.set(key,r);return r
}
if(tmdbEpisode.canonical==="tmdb"){
try{
const ex=await tmdbEpisodeExternal(id,s,e);
if(ex&&ex.tvdb_id&&direct.tvdb_episode_id&&String(ex.tvdb_id)===String(direct.tvdb_episode_id)){const r={tvdb:direct,tmdb:tmdbEpisode,match:"tmdb_tvdb_episode_id"};if(cache)cache.set(key,r);return r}
}catch(_){}
}
}
const inferred=bestTvdbByTmdbEpisode(tvdbEpisodes,tmdbEpisode);
if(inferred){
if((inferred.air_date&&tmdbEpisode.air_date&&dateMatch(inferred.air_date,tmdbEpisode.air_date))||(inferred.title&&titleMatch(inferred.title,tmdbEpisode.title))){
const r={tvdb:inferred,tmdb:tmdbEpisode,match:tmdbEpisode.canonical==="tmdb"?"tmdb_date_or_title":"cinemeta_date_or_title"};if(cache)cache.set(key,r);return r
}
if(tmdbEpisode.canonical==="tmdb"){
try{
const ex=await tmdbEpisodeExternal(id,s,e);
if(ex&&ex.tvdb_id&&inferred.tvdb_episode_id&&String(ex.tvdb_id)===String(inferred.tvdb_episode_id)){const r={tvdb:inferred,tmdb:tmdbEpisode,match:"tmdb_tvdb_episode_id"};if(cache)cache.set(key,r);return r}
}catch(_){}
}
}
const r={tvdb:null,tmdb:tmdbEpisode,match:"canonical_only"};if(cache)cache.set(key,r);return r
}
function parseMalEpisodes(ani){
return Object.values(ani&&ani.episodes||{}).map(x=>({episode:Number(x.episode),tvdb_episode_id:x.tvdbEid||x.tvdbId||null,absolute:x.absoluteEpisodeNumber!=null?Number(x.absoluteEpisodeNumber):null,air_date:day(x.airDateUtc||x.airDate||x.airdate),title:(x.title&&(x.title.en||x.title["x-jat"]||x.title.x))||""})).filter(x=>Number.isInteger(x.episode)&&x.episode>0)
}
async function buildMalCache(malIds){
const cache=new Map();
const tasks = malIds.slice(0,8).map(mal => async () => {
  try {
    const ani = await aniMal(mal);
    cache.set(String(mal), {episodes: parseMalEpisodes(ani), ani});
  } catch(e) {
    cache.set(String(mal), {episodes: [], ani: null});
  }
});
await limitConcurrency(tasks, 3);
return cache;
}
async function buildTitleCache(malIds,malCache){
const cache=new Map();
const tasks = malIds.slice(0,8).map(mal => async () => {
  try {
    const entry = malCache.get(String(mal)) || {episodes: [], ani: null};
    const jd = await jikan(mal);
    cache.set(String(mal), malTitleData(entry.ani, jd));
  } catch(e) {
    try {
      const jd = await jikan(mal);
      cache.set(String(mal), malTitleData(null, jd));
    } catch(_) {
      cache.set(String(mal), {english: null, romanji: null, all: []});
    }
  }
});
await limitConcurrency(tasks, 2);
return cache;
}

async function resolveMalEpisodeInternal(malIds, tvdbEpisode, tmdbEpisode, malCache, fetchLive) {
  for (const mal of malIds.slice(0, 8)) {
    let eps = malCache.get(String(mal))?.episodes || [];
    
    if (!eps.length && fetchLive) {
      try {
        const ani = await aniMal(mal);
        eps = parseMalEpisodes(ani);
        malCache.set(String(mal), { episodes: eps, ani });
      } catch (e) { /* ignore */ }
    }
    
    if (!eps.length) continue;

    if (tvdbEpisode && tvdbEpisode.tvdb_episode_id) {
      const x = eps.find(e => e.tvdb_episode_id && String(e.tvdb_episode_id) === String(tvdbEpisode.tvdb_episode_id));
      if (x) return { mal_id: String(mal), mal_episode: x.episode, match: "tvdb_episode_id", title: x.title };
    }
    if (tvdbEpisode && tvdbEpisode.absolute != null && tvdbEpisode.absolute > 0) {
      const x = eps.find(e => e.absolute != null && Number(e.absolute) === Number(tvdbEpisode.absolute));
      if (x) return { mal_id: String(mal), mal_episode: x.episode, match: "absolute", title: x.title };
    }
    if (tvdbEpisode && tvdbEpisode.air_date) {
      const xs = eps.filter(e => dateMatch(e.air_date, tvdbEpisode.air_date)).sort((a, b) => a.episode - b.episode);
      if (xs.length) {
        const x = xs.find(e => titleMatch(e.title, tvdbEpisode.title)) || xs[0];
        return { mal_id: String(mal), mal_episode: x.episode, match: "air_date", title: x.title };
      }
    }
    if (tvdbEpisode && tvdbEpisode.title) {
      const x = eps.find(e => titleMatch(e.title, tvdbEpisode.title));
      if (x) return { mal_id: String(mal), mal_episode: x.episode, match: "title", title: x.title };
    }
    if (tmdbEpisode && tmdbEpisode.air_date) {
      const xs = eps.filter(e => dateMatch(e.air_date, tmdbEpisode.air_date)).sort((a, b) => a.episode - b.episode);
      if (xs.length) return { mal_id: String(mal), mal_episode: xs[0].episode, match: "canonical_air_date", title: xs[0].title };
    }
  }
  return null;
}

function resolveMalEpisodeCached(malIds, tvdbEpisode, tmdbEpisode, malCache) {
  return resolveMalEpisodeInternal(malIds, tvdbEpisode, tmdbEpisode, malCache, false);
}

async function resolveMalEpisode(malIds, tvdbEpisode, tmdbEpisode) {
  const cache = new Map();
  return resolveMalEpisodeInternal(malIds, tvdbEpisode, tmdbEpisode, cache, true);
}

async function populateWindow(id,s,start,end,seed,parent,oldSeason){
const ext=await external(id);
const[el,series]=await Promise.all([eligibility(id,parent,ext),tmdb(id)]);
if(!el.ok){
if(!el.temporary){
const st=db(),next=Object.assign({},parent||{},{tmdb_id:id,imdb_id:el.imdb,tvdb_id:ext&&ext.tvdb_id||null,animeEligible:false,animeEligibilityReason:"NO_ANIME_SOURCE",checkedAt:Date.now(),updatedAt:Date.now()});
await st.setJSON(`anime:${id}`,next);
log(`NO-ANIME STORED TMDB=${id}`)
}
return{eligible:false,temporary:el.temporary}
}
if(!series)throw new Error(`TMDB series ${id} unavailable`);
const tvdbId=ext&&ext.tvdb_id?String(ext.tvdb_id):null;
let ani=null,aniSource="none";
if(tvdbId){ani=await aniTvdb(tvdbId);if(ani&&ani.episodes)aniSource="tvdb"}
if(!ani||!ani.episodes){ani=await aniTmdb(id,el.imdb);if(ani&&ani.episodes)aniSource="tmdb"}
if(!ani||!ani.episodes)throw new Error(`ani.zip has no episodes for TMDB ${id} TVDB ${tvdbId}`);
const tvdbEpisodes=aniEpisodeList(ani),oldEpisodes=oldSeason&&oldSeason.episodes||{};
const season=await tmdbSeason(id,s),tmdbEpisodes=episodeFromSeason(id,s,season);
const requestedExists=tmdbEpisodes.some(x=>x.tmdb_season===s&&x.tmdb_episode===start);
let cinemetaEpisodeList=[];
if(!requestedExists){
cinemetaEpisodeList=await cinemetaEpisodes(el.imdb);
if(cinemetaEpisodeList.length)log(`CANONICAL FALLBACK CINEMETA TMDB=${id} episodes=${cinemetaEpisodeList.length} REQUEST S${s}E${start}`)
}
const seasonCount=tvdbEpisodes.filter(x=>x.tvdb_season===s).length,total=Math.max(seasonCount,Number(oldSeason&&oldSeason.totalEpisodes||0),end);
log(`SOURCE=${aniSource} TMDB=${id} TVDB=${tvdbId||"none"} episodes=${tvdbEpisodes.length} seasons=${uniq(tvdbEpisodes.map(x=>x.tvdb_season)).join(",")||"none"} REQUEST S${s}E${start}-${end} TVDB_SAME_NUMBER=${seasonCount}`);
log(`CANONICAL TMDB=${id} REQUEST S${s}E${start}-${end} TMDB_SEASON_EPISODES=${tmdbEpisodes.length} REQUEST_FOUND=${requestedExists}`);
const needed=[];for(let n=Math.max(1,start);n<=end;n++)if(!oldEpisodes[String(n)]||oldEpisodes[String(n)].mal_episode==null)needed.push(n);
log(`WINDOW TMDB=${id} S${s} total=${total} range=${start}-${end} existing=${Object.keys(oldEpisodes).length} missing=${needed.length}`);
if(!needed.length){const sState=oldSeason||{tmdb_id:id,tvdb_id:tvdbId,totalEpisodes:total,episodes:oldEpisodes,mappedThrough:through(total,oldEpisodes),complete:through(total,oldEpisodes)>=total};return{eligible:true,seasonState:sState,mapped:0,failed:0}}
const armIds=(await arm(id,el.imdb,tvdbId)).ids,malCandidates=uniq([el.mal,...aniIds(ani),...armIds]),malCache=await buildMalCache(malCandidates),titleCache=await buildTitleCache(malCandidates,malCache),added={},unresolved=[],resolutionCache=new Map();
const resolveOne=async ep=>{
const resolved=await resolveTvdbEpisode(id,s,ep,tvdbEpisodes,tmdbEpisodes,cinemetaEpisodeList,resolutionCache),tvdbEpisode=resolved.tvdb,tmdbEpisode=resolved.tmdb;
if(!tmdbEpisode){unresolved.push(ep);log(`CANONICAL RESOLVE MISS TMDB=${id} REQUEST S${s}E${ep}`);return}
if(!tvdbEpisode){unresolved.push(ep);log(`TVDB RESOLVE MISS TMDB=${id} REQUEST S${s}E${ep} CANONICAL=${tmdbEpisode.canonical||"tmdb"} DATE=${tmdbEpisode.air_date||"none"}`);return}
const mal=resolveMalEpisodeCached(malCandidates,tvdbEpisode,tmdbEpisode,malCache);
if(!mal){unresolved.push(ep);log(`MAL RESOLVE MISS TMDB=${id} REQUEST S${s}E${ep} TVDB S${tvdbEpisode.tvdb_season}E${tvdbEpisode.tvdb_episode}`);return}
const mt=titleCache.get(String(mal.mal_id))||{english:null,romanji:null,all:[]};
added[String(ep)]={title:tvdbEpisode.title||tmdbEpisode.title||"",episode_title:tvdbEpisode.title||tmdbEpisode.title||"",air_date:tvdbEpisode.air_date||tmdbEpisode.air_date||"",tvdb_id:tvdbId||null,tvdb_season:tvdbEpisode.tvdb_season,tvdb_episode:tvdbEpisode.tvdb_episode,tvdb_episode_id:tvdbEpisode.tvdb_episode_id,tmdb_id:id,tmdb_season:tmdbEpisode.tmdb_season,tmdb_episode:tmdbEpisode.tmdb_episode,tmdb_episode_id:tmdbEpisode.tmdb_episode_id||null,mal_id:mal.mal_id,mal_episode:mal.mal_episode,mal_title:mt.romanji||mt.english||mal.title||null,mal_title_romanji:mt.romanji||null,mal_title_english:mt.english||null,titles:mt.all,match_source:mal.match,updatedAt:Date.now()};
log(`RESOLVED TMDB=${id} REQUEST S${s}E${ep} CANONICAL=${tmdbEpisode.canonical||"tmdb"} -> TVDB S${tvdbEpisode.tvdb_season}E${tvdbEpisode.tvdb_episode} TVDB_ID=${tvdbEpisode.tvdb_episode_id||"none"} -> TMDB S${tmdbEpisode.tmdb_season}E${tmdbEpisode.tmdb_episode} -> MAL=${mal.mal_id} E${mal.mal_episode} via=${mal.match}`)
};
for(let i=0;i<needed.length;i+=CONCURRENCY)await Promise.all(needed.slice(i,i+CONCURRENCY).map(resolveOne));
const finalUnresolved=[];
if(unresolved.length){
for(let i=0;i<unresolved.length;i+=CONCURRENCY){
const batch=unresolved.slice(i,i+CONCURRENCY),rs=await Promise.all(batch.map(async ep=>{try{return{ep,shared:await sharedLookup(id,s,ep,tvdbId)}}catch(e){return{ep,shared:null}}}));
for(const{ep,shared}of rs){
if(shared&&shared.mapping){
const m=shared.mapping,meta={title:m.episode_title||m.anime_title||"",episode_title:m.episode_title||"",air_date:m.air_date||"",tvdb_id:m.tvdb_id||tvdbId,tvdb_season:m.tvdb_season,tvdb_episode:m.tvdb_episode,tvdb_episode_id:m.tvdb_episode_id||null,tmdb_id:id,tmdb_season:m.tmdb_season,tmdb_episode:m.tmdb_episode,tmdb_episode_id:m.tmdb_episode_id||null,mal_id:m.mal_id,mal_episode:m.mal_episode,mal_title:m.mal_title||m.anime_title||null,mal_title_romanji:m.mal_title_romanji||null,mal_title_english:m.mal_title_english||null,titles:m.titles||[],imdb_id:m.imdb_id||el.imdb||null};
added[String(ep)]=meta;
log(`SHARED RESCUE TMDB=${id} S${s}E${ep} -> TVDB S${meta.tvdb_season||"?"}E${meta.tvdb_episode||"?"} -> MAL=${meta.mal_id} E${meta.mal_episode}`)
}else finalUnresolved.push(ep)
}
}
}
const state=Object.assign({},oldSeason||{},{tmdb_id:id,tvdb_id:tvdbId,imdb_id:el.imdb,mal_id:el.mal,title:(oldSeason&&oldSeason.title)||`Season ${s}`,totalEpisodes:total,episodes:Object.assign({},oldEpisodes,added),updatedAt:Date.now()});
state.mappedThrough=through(total,state.episodes);state.complete=state.mappedThrough>=total;
const st=db();await st.setJSON(`anime:${id}:season:${s}`,state);
const first=Object.values(added)[0]||{},next=Object.assign({},parent||{},{tmdb_id:id,imdb_id:el.imdb,tvdb_id:tvdbId,mal_id:el.mal,title:series.name||series.original_name||seed.title||"",titles:titles([...(parent&&parent.titles||[]),series.name,series.original_name,...(first.titles||[])]),mal_title:first.mal_title||parent&&parent.mal_title||null,mal_title_english:first.mal_title_english||parent&&parent.mal_title_english||null,mal_title_romanji:first.mal_title_romanji||parent&&parent.mal_title_romanji||null,animeEligible:true,animeEligibilityReason:"SOURCE_CONFIRMED",updatedAt:Date.now()});
await st.setJSON(`anime:${id}`,next);
await writeLazyMappings(tvdbId,added);
log(`WINDOW DONE TMDB=${id} S${s} range=${start}-${end} mapped=${Object.keys(added).length} failed=${finalUnresolved.length} mappedThrough=${state.mappedThrough} src=${aniSource}`);
return{eligible:true,seasonState:state,mapped:Object.keys(added).length,failed:finalUnresolved.length}
}
async function populate(seed){const id=String(seed.tmdb_id),s=Number(seed.season),e=Number(seed.episode),st=db(),parent=await readSeries(st,id),old=await readSeason(st,id,s),current=old&&old.episodes||{},mappedThrough=Number(old&&old.mappedThrough||0),need=current[String(e)]&&current[String(e)].mal_episode!=null?[]:[e];if(!need.length){log(`REQUESTED EPISODE ALREADY MAPPED TMDB=${id} S${s}E${e}`);return{ok:true,skipped:true,seasonState:old}}const start=Math.max(1,e),end=start+MAX_WINDOW-1;log(`POPULATE REQUEST TMDB=${id} S${s}E${e} mappedThrough=${mappedThrough} range=${start}-${end}`);return populateWindow(id,s,start,end,seed,parent,old)}
async function advanceBoundary(id,s,e,ss,seed,parent){if(ss&&ss.exhausted){log(`EXHAUSTED TMDB=${id} S${s}`);return{ok:true,existing:true,boundary:true,exhausted:true,seasonState:ss}}const total=Number(ss&&ss.totalEpisodes||0);if(total&&e<total){const start=Math.max(1,e+1),end=Math.min(total,start+MAX_WINDOW-1);log(`BOUNDARY ADVANCE TMDB=${id} S${s} E${e} -> S${s}E${start}-${end}`);const r=await populateWindow(id,s,start,end,seed,parent,ss);return Object.assign({},r,{boundary:true,advanced:true})}const st=db(),now=Date.now(),seasonState=Object.assign({},ss||{},{tmdb_id:id,totalEpisodes:total,mappedThrough:Number(ss&&ss.mappedThrough||e),complete:true,exhausted:true,exhaustedAt:now,updatedAt:now});await st.setJSON(`anime:${id}:season:${s}`,seasonState);log(`SEASON EXHAUSTED TMDB=${id} S${s}`);return{ok:true,existing:true,boundary:true,exhausted:true,seasonState}}
async function populateIfNeeded(seed){
const id=String(seed.tmdb_id),s=Number(seed.season),e=Number(seed.episode),st=db(),existing=await sharedLookup(id,s,e);
if(existing)return{ok:true,existing:true,boundary:false,mapping:existing.mapping};
const locked=await lock(st,id);
if(!locked)return{ok:false,locked:true,boundary:true};
try{
const again=await sharedLookup(id,s,e);
if(again)return{ok:true,existing:true,boundary:false,mapping:again.mapping};
const r=await populate(seed);
return Object.assign({},r,{boundary:false})
}finally{await unlock(st,id)}
}
async function boundaryState(id,s,e){const st=db(),ss=await readSeason(st,id,s);if(!ss)return{boundary:false};const isBoundary=Number(ss.mappedThrough)===e;return{boundary:isBoundary,seasonComplete:!!ss.complete,totalEpisodes:Number(ss.totalEpisodes||0),mappedThrough:Number(ss.mappedThrough||0)}}
async function eligibilityState(id){
 try{
  const record=await readSeries(db(),id);
  if(record&&record.animeEligible===true)return"anime";
  if(record&&record.animeEligible===false&&record.animeEligibilityReason==="NO_ANIME_SOURCE")return"non_anime";
 }catch(e){}
 return"unknown"
}
function origin(event){
const h=event&&event.headers||{},host=h.host||h.Host||"";
if(host)return`${String(h["x-forwarded-proto"]||h["X-Forwarded-Proto"]||"https").split(",")[0]}://${host}`;
return String(process.env.URL||process.env.DEPLOY_PRIME_URL||"").replace(/\/$/,"")
}
async function triggerBackground(event,seed){
const base=origin(event);
if(!base)return false;
const url=`${base}/.netlify/functions/anime-lazy-populate-background`;
const internalSecret=String(process.env.ANIME_POPULATION_SECRET||process.env.NETLIFY_AUTH_TOKEN||"");
if(!internalSecret){log("LAZY POPULATION BLOCKED: internal trigger secret is not configured");return false}
try{
void fetch(url,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json","Authorization":"Bearer "+internalSecret},body:JSON.stringify(seed)}).then(r=>log(`LAZY POPULATION START TMDB=${seed.tmdb_id} S${seed.season}E${seed.episode} HTTP=${r.status}`)).catch(e=>log(`LAZY POPULATION TRIGGER FAILED ${String(e)}`));
return true
}catch(error){log(`LAZY POPULATION LAUNCH FAILED ${String(error)}`);return false}
}
async function waitForShared(id,s,e,maxWait=MAX_MAPPING_WAIT){
const started=Date.now();
while(Date.now()-started<maxWait){
const hit=await sharedLookup(id,s,e);
if(hit)return hit;
await new Promise(resolve=>setTimeout(resolve,MAPPING_POLL_MS));
}
return null
}
exports.handler=async event=>{
const started=Date.now(),method=(event.httpMethod||"GET").toUpperCase();
if(method==="OPTIONS")return json(204,{});
if(method!=="GET")return json(405,{ok:false,error:"Method not allowed"});
try{
const p=event.queryStringParameters||{},id=String(p.tmdbId||p.tmdb_id||"").trim(),s=num(p.season),e=pos(p.episode);
log(`REQUEST TMDB=${id} S${p.season}E${p.episode}`);
if(!/^\d+$/.test(id)||id.length>MAX_ID||s===null||!e)return json(400,{ok:false,error:"tmdbId, season and episode are required"});
const hit=await sharedLookup(id,s,e);
if(hit){
log(`RESULT source=${hit.source} time=${Date.now()-started}ms`);
return json(200,{ok:true,source:hit.source,updatedAt:Date.now(),mapping:hit.mapping,eligibility:"anime",state:await boundaryState(id,s,e)})
}
const explicitPopulation=String(p.populate||"")==="1"&&String(p.trigger||"")==="anizone-lazy"&&String(p.pending||"")!=="1";
if(explicitPopulation){
const st = db();
const lockKey = `building:${id}`;
const lockCheck = await st.get(lockKey, {type:"json", consistency:"eventual"}).catch(() => null);
const isLocked = lockCheck && Number(lockCheck.expiresAt) > Date.now();
if (!isLocked) {
    log(`TRIGGERING BACKGROUND POPULATION TMDB=${id}`);
    const seed={tmdb_id:id,season:s,episode:e};
    const launched=await triggerBackground(event,seed);
    if(launched){
        const pendingHit=await waitForShared(id,s,e);
        if(pendingHit){
            log(`RESULT source=${pendingHit.source} time=${Date.now()-started}ms`);
            return json(200,{ok:true,source:pendingHit.source,updatedAt:Date.now(),mapping:pendingHit.mapping,state:await boundaryState(id,s,e)})
        }
    }
} else {
    log(`POPULATION ALREADY LOCKED TMDB=${id}, waiting for shared`);
    const pendingHit=await waitForShared(id,s,e);
    if(pendingHit){
        log(`RESULT source=${pendingHit.source} time=${Date.now()-started}ms`);
        return json(200,{ok:true,source:pendingHit.source,updatedAt:Date.now(),mapping:pendingHit.mapping,state:await boundaryState(id,s,e)})
    }
}
}
const eligibility=await eligibilityState(id);
log(`RESULT source=pending eligibility=${eligibility} time=${Date.now()-started}ms`);
return json(202,{ok:false,pending:true,mapping:null,eligibility,error:eligibility==="non_anime"?"Title is not eligible for anime mapping":"Anime mapping unavailable or population pending",state:await boundaryState(id,s,e)})
}catch(error){
console.error("[ANIME LAZY MAPPING] FATAL",error);
return json(500,{ok:false,error:error&&error.message?error.message:"Mapping service error"})
}
};
exports.populateIfNeeded=populateIfNeeded;
