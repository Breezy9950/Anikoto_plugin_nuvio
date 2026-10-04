const{getStore}=require("@netlify/blobs");

const STORE_NAME="anibridge-mapping";
const META_KEY="meta";
const SOURCE_URL="https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json";
const SHARDS=64;
const REFRESH_MS=48*60*60*1000;
const USER_AGENT="AniKoto-Nuvio/AniBridge-Updater";

function log(...x){console.log("[ANIBRIDGE UPDATER]",...x)}
function shardFor(provider,id){let n=Number(id);if(!Number.isFinite(n))n=0;let p=provider==="tmdb_show"?1:provider==="mal"?2:provider==="anilist"?3:7;return(Math.abs(n)*31+p)%SHARDS}
function parseDescriptor(s){
  const m=String(s||"").match(/^(anidb|anilist|imdb_movie|imdb_show|mal|tmdb_show|tmdb_movie|tvdb_show):([^:]+)(?::(.+))?$/);
  return m?{provider:m[1],id:m[2],scope:m[3]||null}:null;
}
function normalizeRanges(targets){
  const out=[];
  for(const[targetKey,ranges]of Object.entries(targets||{})){
    const t=parseDescriptor(targetKey);
    if(!t)continue;
    const rr=[];
    for(const[sourceRange,targetRange]of Object.entries(ranges||{})){
      if(typeof targetRange!=="string")continue;
      rr.push([sourceRange,targetRange]);
    }
    if(rr.length)out.push({provider:t.provider,id:t.id,scope:t.scope,ranges:rr});
  }
  return out;
}
function addRecord(shards,descriptor,targets){
  const d=parseDescriptor(descriptor);
  if(!d||!targets.length)return false;
  const key=descriptor;
  const shard=shards[shardFor(d.provider,d.id)];
  if(!shard[key])shard[key]={provider:d.provider,id:d.id,scope:d.scope,targets:[]};
  for(const t of targets){
    const exists=shard[key].targets.find(x=>x.provider===t.provider&&x.id===t.id&&x.scope===t.scope);
    if(exists){
      for(const r of t.ranges)exists.ranges.push(r);
    }else shard[key].targets.push({provider:t.provider,id:t.id,scope:t.scope,ranges:t.ranges.slice()});
  }
  return true;
}

function buildIndex(source){
  const shards=Array.from({length:SHARDS},()=>({}));
  let descriptors=0,tmdb=0,mal=0,anilist=0,targets=0,ranges=0;
  for(const[sourceDescriptor,targetMap]of Object.entries(source||{})){
    const targetList=normalizeRanges(targetMap);
    if(!targetList.length)continue;
    if(addRecord(shards,sourceDescriptor,targetList)){
      descriptors++;
      const d=parseDescriptor(sourceDescriptor);
      if(d.provider==="tmdb_show"||d.provider==="tmdb_movie")tmdb++;
      if(d.provider==="mal")mal++;
      if(d.provider==="anilist")anilist++;
      targets+=targetList.length;
      ranges+=targetList.reduce((n,x)=>n+x.ranges.length,0);
    }
  }
  return{shards,descriptors,tmdb,mal,anilist,targets,ranges};
}

exports.handler=async()=>{
  const started=Date.now();
  log("========================================");
  log("Updater START");
  log("Source:",SOURCE_URL);
  try{
    const store=getStore(STORE_NAME);
    const oldMeta=await store.get(META_KEY,{type:"json"});
    if(oldMeta?.updatedAt&&Date.now()-Number(oldMeta.updatedAt)<REFRESH_MS){
      log(`SKIP active mapping age=${Date.now()-Number(oldMeta.updatedAt)}ms`);
      return;
    }

    const res=await fetch(SOURCE_URL,{headers:{Accept:"application/json","User-Agent":USER_AGENT}});
    log(`Source response HTTP ${res.status} ok=${res.ok}`);
    if(!res.ok)throw new Error(`AniBridge source HTTP ${res.status}`);

    const text=await res.text();
    log(`Source downloaded bytes=${text.length}`);
    if(text.length<1000)throw new Error("AniBridge source unexpectedly small");

    const source=JSON.parse(text);
    const built=buildIndex(source);

    log(`Built descriptors=${built.descriptors} tmdb=${built.tmdb} mal=${built.mal} anilist=${built.anilist} targets=${built.targets} ranges=${built.ranges}`);

    if(!built.tmdb)throw new Error("No TMDB mappings found");
    if(!built.mal&&!built.anilist)throw new Error("No MAL/AniList mappings found");

    const version=String(Date.now());
    const prefix=`v${version}`;
    let bytes=0;

    for(let i=0;i<SHARDS;i++){
      const payload=JSON.stringify(built.shards[i]);
      bytes+=payload.length;
      await store.set(`${prefix}/shard-${i}`,payload,{contentType:"application/json"});
      log(`Shard ${i+1}/${SHARDS} written bytes=${payload.length}`);
    }

    const testShard=built.shards[shardFor("tmdb_show","285993")];
    if(!testShard||typeof testShard!=="object")throw new Error("Shard verification failed");

    const newMeta={
      activeVersion:version,
      updatedAt:Date.now(),
      source:SOURCE_URL,
      shards:SHARDS,
      descriptors:built.descriptors,
      tmdbDescriptors:built.tmdb,
      malDescriptors:built.mal,
      anilistDescriptors:built.anilist,
      targets:built.targets,
      ranges:built.ranges,
      bytes
    };

    await store.setJSON(META_KEY,newMeta);
    log(`ACTIVE VERSION switched to ${version}`);

    if(oldMeta?.activeVersion&&oldMeta.activeVersion!==version){
      for(let i=0;i<SHARDS;i++){
        try{await store.delete(`v${oldMeta.activeVersion}/shard-${i}`)}catch{}
      }
      log(`Old version ${oldMeta.activeVersion} removed`);
    }

    log(`Updater SUCCESS bytes=${bytes} time=${Date.now()-started}ms`);
    log("========================================");
  }catch(e){
    log("FATAL:",e?.stack||e);
    log("Old mapping remains active.");
    log("========================================");
    throw e;
  }
};

exports.config={schedule:"0 0 * * *"};
