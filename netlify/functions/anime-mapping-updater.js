const{getStore}=require("@netlify/blobs");
const YAML=require("yaml");
const STORE_NAME="anime-resolution-cache";
const INDEX_KEY="_shinkro_index";
const META_KEY="_shinkro_source_meta";
const SOURCE_URL="https://raw.githubusercontent.com/shinkro/community-mapping/main/tvdb-mal.yaml";
const MAX_SOURCE_BYTES=5*1024*1024;
const MAX_INDEX_BYTES=5*1024*1024;

function log(message){console.log(`[SHINKRO] ${message}`)}
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
}
}
function normalizeCandidate(entry){
if(!entry||typeof entry!=="object")return null;
const malId=Number(entry.malid),tvdbSeason=Number(entry.tvdbseason),start=Number(entry.start);
if(!Number.isInteger(malId)||malId<1||!Number.isInteger(tvdbSeason)||tvdbSeason<0)return null;
return{
malid:malId,
title:typeof entry.title==="string"?entry.title.trim():"",
type:typeof entry.type==="string"?entry.type:"",
tvdbseason:tvdbSeason,
start:Number.isFinite(start)?Math.max(0,start):0,
useMapping:entry.useMapping===true,
animeMapping:Array.isArray(entry.animeMapping)?entry.animeMapping.map(normalizeAnimeMapping).filter(Boolean):[]
}
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
for(const list of Object.values(byTvdb))list.sort((a,b)=>a.tvdbseason-b.tvdbseason||a.start-b.start||a.malid-b.malid);
log(`Parsed new source candidates=${accepted} tvdbIds=${Object.keys(byTvdb).length}`);
return byTvdb
}
function candidateKey(x){
return[
Number(x&&x.malid)||0,
Number(x&&x.tvdbseason)||0,
typeof x&&x.type?String(x.type):""
].join("|")
}
function mergeCandidates(oldList,newList){
const out=Array.isArray(oldList)?oldList.map(x=>x):[];
const positions=new Map();
for(let i=0;i<out.length;i++)positions.set(candidateKey(out[i]),i);
for(const item of newList||[]){
const key=candidateKey(item),pos=positions.get(key);
if(pos===undefined){
positions.set(key,out.length);
out.push(item)
}else out[pos]=item
}
out.sort((a,b)=>Number(a.tvdbseason)-Number(b.tvdbseason)||Number(a.start)-Number(b.start)||Number(a.malid)-Number(b.malid));
return out
}
function mergeIndex(oldIndex,newByTvdb){
const oldByTvdb=oldIndex&&oldIndex.byTvdb&&typeof oldIndex.byTvdb==="object"?oldIndex.byTvdb:{};
const byTvdb=Object.assign({},oldByTvdb);
let added=0,updated=0;
for(const[tvdbId,newList]of Object.entries(newByTvdb)){
const oldList=Array.isArray(byTvdb[tvdbId])?byTvdb[tvdbId]:[];
const oldJson=JSON.stringify(oldList);
const merged=mergeCandidates(oldList,newList);
const mergedJson=JSON.stringify(merged);
if(!oldList.length){
added+=merged.length
}else if(oldJson!==mergedJson){
updated++
}
byTvdb[tvdbId]=merged
}
const result={
version:1,
source:"shinkro-community-mapping",
updatedAt:Date.now(),
byTvdb
};
log(`MERGE complete newTvdbIds=${Object.keys(newByTvdb).length} addedTvdbIds=${added} changedTvdbIds=${updated} totalTvdbIds=${Object.keys(byTvdb).length}`);
return result
}
exports.handler=async()=>{
const started=Date.now();
log("========================================");
log("Updater START");
log(`Source: ${SOURCE_URL}`);
try{
const store=getStore({name:STORE_NAME,siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN});
let meta=null;
try{meta=await store.get(META_KEY,{type:"json",consistency:"strong"})}catch(e){log(`Metadata read failed: ${e.message}`)}
const headers={
"User-Agent":"Breezy-Plugins-AniZone/1.0",
"Accept":"text/yaml,text/plain;q=0.9,*/*;q=0.8"
};
if(meta&&meta.etag)headers["If-None-Match"]=String(meta.etag);
if(meta&&meta.lastModified)headers["If-Modified-Since"]=String(meta.lastModified);
const response=await fetch(SOURCE_URL,{headers});
log(`Source response HTTP ${response.status}`);
if(response.status===304){
log("SOURCE UNCHANGED - no download, no rebuild, no Blob write");
log(`Updater SKIPPED time=${Date.now()-started}ms`);
log("========================================");
return
}
if(!response.ok)throw new Error(`Shinkro download failed: HTTP ${response.status}`);
const contentLength=response.headers.get("content-length");
if(contentLength&&Number.isFinite(Number(contentLength))&&Number(contentLength)>MAX_SOURCE_BYTES)throw new Error(`Shinkro source exceeds ${MAX_SOURCE_BYTES} byte safety limit`);
const text=await response.text();
const sourceBytes=Buffer.byteLength(text,"utf8");
log(`Source changed; downloaded bytes=${sourceBytes}`);
if(sourceBytes>MAX_SOURCE_BYTES)throw new Error(`Shinkro source exceeds ${MAX_SOURCE_BYTES} byte safety limit`);
let data;
try{data=YAML.parse(text)}catch(error){throw new Error(`Invalid Shinkro YAML: ${error.message}`)}
const newByTvdb=buildIndex(data);
const newCount=Object.keys(newByTvdb).length;
if(!newCount)throw new Error("Shinkro dataset produced an empty index");
const oldIndex=await store.get(INDEX_KEY,{type:"json",consistency:"strong"});
if(oldIndex&&oldIndex.byTvdb){
log(`Existing index found tvdbIds=${Object.keys(oldIndex.byTvdb).length}`);
}else{
log("No existing index found; creating initial index")
}
const merged=mergeIndex(oldIndex,newByTvdb);
const indexJson=JSON.stringify(merged);
const indexBytes=Buffer.byteLength(indexJson,"utf8");
log(`Merged index tvdbIds=${Object.keys(merged.byTvdb).length} bytes=${indexBytes}`);
if(indexBytes>MAX_INDEX_BYTES)throw new Error(`Merged Shinkro index exceeds ${MAX_INDEX_BYTES} byte safety limit`);
await store.setJSON(INDEX_KEY,merged);
const sourceMeta={
etag:response.headers.get("etag")||null,
lastModified:response.headers.get("last-modified")||null,
sourceBytes,
checkedAt:Date.now()
};
await store.setJSON(META_KEY,sourceMeta);
log(`Blob write SUCCESS ${INDEX_KEY}`);
log(`Metadata write SUCCESS ${META_KEY}`);
log(`Updater SUCCESS source=${sourceBytes}B index=${indexBytes}B time=${Date.now()-started}ms`);
log("========================================");
}catch(error){
console.error(`[SHINKRO] Updater FAILED after ${Date.now()-started}ms`,error);
log(`ERROR MESSAGE: ${error&&error.message?error.message:"Unknown error"}`);
log("========================================")
}
};
