const{getStore}=require("@netlify/blobs");
const YAML=require("yaml");
const STORE_NAME="anime-resolution-cache";
const INDEX_KEY="_shinkro_index"; 
const MANIFEST_KEY="_shinkro:manifest";
const TVDB_PREFIX="_shinkro:tvdb:";
const SOURCE_URL="https://raw.githubusercontent.com/shinkro/community-mapping/main/tvdb-mal.yaml";
const MAX_SOURCE_BYTES=5*1024*1024;
const MAX_INDEX_BYTES=5*1024*1024;
const WRITE_CONCURRENCY=8,WRITE_LOCK_TTL=30_000;

function log(message){console.log(`[SHINKRO] ${message}`);}
function normalizeCandidate(entry){
if(!entry||typeof entry!=="object")return null;
const malId=Number(entry.malid),tvdbSeason=Number(entry.tvdbseason),start=Number(entry.start);
if(!Number.isInteger(malId)||malId<1)return null;
if(!Number.isInteger(tvdbSeason)||tvdbSeason<0)return null;
return{
malid:malId,
title:typeof entry.title==="string"?entry.title.trim():"",
type:typeof entry.type==="string"?entry.type:"",
tvdbseason:tvdbSeason,
start:Number.isFinite(start)?Math.max(0,start):0,
useMapping:entry.useMapping===true,
animeMapping:Array.isArray(entry.animeMapping)?entry.animeMapping.map(normalizeAnimeMapping).filter(Boolean):[],
titles:Array.isArray(entry.titles)?entry.titles.map(String).filter(Boolean).slice(0,50):[],
source:entry.source==="lazy"?"lazy":"shinkro",
updatedAt:Number(entry.updatedAt)||null,
episodeMetadata:entry.episodeMetadata&&typeof entry.episodeMetadata==="object"&&!Array.isArray(entry.episodeMetadata)?entry.episodeMetadata:{}
};
}
function normalizeAnimeMapping(entry){
if(!entry||typeof entry!=="object")return null;
const season=Number(entry.tvdbseason),start=Number(entry.start);
if(!Number.isInteger(season)||season<0)return null;
return{
tvdbseason:season,
start:Number.isFinite(start)?Math.max(0,start):0,
mappingType:entry.mappingType==="explicit"?"explicit":"range",
explicitEpisodes:entry.explicitEpisodes&&typeof entry.explicitEpisodes==="object"&&!Array.isArray(entry.explicitEpisodes)?entry.explicitEpisodes:{},
skipMalEpisodes:Array.isArray(entry.skipMalEpisodes)?entry.skipMalEpisodes.map(Number).filter(Number.isInteger):[]
};
}
function buildIndex(data){
const byTvdb={},animeMap=data&&data.AnimeMap;
if(!Array.isArray(animeMap))throw new Error("Shinkro YAML does not contain AnimeMap");
let accepted=0;
for(const raw of animeMap){
const tvdbId=Number(raw&&raw.tvdbid),candidate=normalizeCandidate(raw);
if(!Number.isInteger(tvdbId)||tvdbId<1||!candidate)continue;
if(!byTvdb[tvdbId])byTvdb[tvdbId]=[];
byTvdb[tvdbId].push(candidate);
accepted++;
}
for(const list of Object.values(byTvdb))list.sort(compareCandidates);
log(`Parsed candidates=${accepted} tvdbIds=${Object.keys(byTvdb).length}`);
return{version:2,source:"shinkro-community-mapping",updatedAt:Date.now(),byTvdb};
}
function compareCandidates(a,b){
const as=a&&a.source==="lazy"?1:0,bs=b&&b.source==="lazy"?1:0;
if(as!==bs)return as-bs;
return Number(a&&a.tvdbseason||0)-Number(b&&b.tvdbseason||0)||
Number(a&&a.start||0)-Number(b&&b.start||0)||
Number(a&&a.malid||0)-Number(b&&b.malid||0);
}
function sameCandidate(a,b){
return a&&b&&Number(a.malid)===Number(b.malid)&&Number(a.tvdbseason)===Number(b.tvdbseason);
}
async function readExistingCandidates(store,id){
try{
const existing=await store.get(`${TVDB_PREFIX}${id}`,{type:"json",consistency:"eventual"});
if(Array.isArray(existing))return existing.map(normalizeCandidate).filter(Boolean);
if(existing&&Array.isArray(existing.candidates))return existing.candidates.map(normalizeCandidate).filter(Boolean);
}catch(error){log(`Existing shared record read failed id=${id} error=${error.message}`);}
return[];
}
async function mergeSharedCandidates(store,id,shinkroCandidates){
const lockKey=`_shared_mapping_lock:${id}`,now=Date.now();
for(let attempt=0;attempt<10;attempt++){
const old=await store.get(lockKey,{type:"json",consistency:"eventual"}).catch(()=>null);
if(old&&Number(old.expiresAt)>Date.now()){
await new Promise(r=>setTimeout(r,50*Math.pow(2,attempt)));
continue;
}
if(old)await store.delete(lockKey).catch(()=>{});
const lock=await store.setJSON(lockKey,{startedAt:Date.now(),expiresAt:Date.now()+WRITE_LOCK_TTL},{onlyIfNew:true}).catch(()=>null);
if(!lock||!lock.modified){
await new Promise(r=>setTimeout(r,50*Math.pow(2,attempt)));
continue;
}
try{
const existing=await readExistingCandidates(store,id),lazy=existing.filter(x=>x.source==="lazy"),shinkro=shinkroCandidates.map(normalizeCandidate).filter(Boolean);
const merged=shinkro.concat(lazy.filter(l=>!shinkro.some(s=>sameCandidate(s,l))));
merged.sort(compareCandidates);
await store.setJSON(`${TVDB_PREFIX}${id}`,merged);
return merged;
}finally{await store.delete(lockKey).catch(()=>{})}
}
throw new Error(`Shared mapping write lock busy for TVDB ${id}`);
}

exports.handler=async()=>{
const started=Date.now();
log("========================================");
log("Updater START");
log(`Source: ${SOURCE_URL}`);
try{
const response=await fetch(SOURCE_URL,{headers:{"User-Agent":"Breezy-Plugins-AniZone/1.0","Accept":"text/yaml,text/plain;q=0.9,*/*;q=0.8"}});
log(`Source response HTTP ${response.status} ok=${response.ok}`);
if(!response.ok)throw new Error(`Shinkro download failed: HTTP ${response.status}`);
const contentLength=response.headers.get("content-length");
if(contentLength&&Number.isFinite(Number(contentLength))&&Number(contentLength)>MAX_SOURCE_BYTES)throw new Error(`Shinkro source exceeds ${MAX_SOURCE_BYTES} byte safety limit`);
const text=await response.text();
const sourceBytes=Buffer.byteLength(text,"utf8");
log(`Source downloaded bytes=${sourceBytes}`);
if(sourceBytes>MAX_SOURCE_BYTES)throw new Error(`Shinkro source exceeds ${MAX_SOURCE_BYTES} byte safety limit`);
let data;
try{data=YAML.parse(text)}catch(error){throw new Error(`Invalid Shinkro YAML: ${error.message}`)}
const index=buildIndex(data);
const entryCount=Object.keys(index.byTvdb).length,indexJson=JSON.stringify(index),indexBytes=Buffer.byteLength(indexJson,"utf8");
log(`Index built tvdbIds=${entryCount} bytes=${indexBytes}`);
if(!entryCount)throw new Error("Shinkro dataset produced an empty index");
if(indexBytes>MAX_INDEX_BYTES)throw new Error(`Generated Shinkro index exceeds ${MAX_INDEX_BYTES} byte safety limit`);
const store=getStore({name:STORE_NAME,siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN});
const ids=Object.keys(index.byTvdb);
let written=0;
for(let i=0;i<ids.length;i+=WRITE_CONCURRENCY){
const batch=ids.slice(i,i+WRITE_CONCURRENCY);
await Promise.all(batch.map(async id=>{
try{
await mergeSharedCandidates(store,id,index.byTvdb[id]);
written++;
}catch(error){log(`Per-TVDB write failed id=${id} error=${error.message}`)}
}));
}
log(`Shared per-TVDB writes ok=${written}/${ids.length}`);
await store.setJSON(MANIFEST_KEY,{version:2,updatedAt:index.updatedAt,count:written});
log(`Manifest write SUCCESS ${MANIFEST_KEY}`);
// OPTIMIZATION: Removed legacy INDEX_KEY write to save massive Blob operations. 
// If you still need it for migration fallback, uncomment the line below.
// await store.setJSON(INDEX_KEY,index);
// log(`Legacy index write SUCCESS ${INDEX_KEY}`);
log(`Updater SUCCESS source=${sourceBytes}B index=${indexBytes}B perTvdb=${written} time=${Date.now()-started}ms`);
log("========================================");
}catch(error){
console.error(`[SHINKRO] Updater FAILED after ${Date.now()-started}ms`,error);
log(`ERROR MESSAGE: ${error&&error.message?error.message:"Unknown error"}`);
log("========================================");
}
};
