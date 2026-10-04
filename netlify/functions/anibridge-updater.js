const{getStore}=require("@netlify/blobs");

const STORE_NAME="anibridge-mapping";
const META_KEY="meta";
const SOURCE_URL="https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json";
const SHARDS=16;
const REFRESH_MS=48*60*60*1000;
const UA="AniKoto-Nuvio/AniBridge-Updater";
const KEEP=new Set(["tmdb_show","tmdb_movie","mal","anilist"]);

function log(...x){console.log("[ANIBRIDGE UPDATER]",...x)}
function shardFor(provider,id){let n=Number(id)||0,p=provider==="tmdb_show"?1:provider==="tmdb_movie"?2:provider==="mal"?3:4;return(Math.abs(n)*31+p)%SHARDS}
function descriptor(s){
  const m=String(s||"").match(/^(tmdb_show|tmdb_movie|mal|anilist):([^:]+)(?::(.+))?$/);
  return m?{provider:m[1],id:m[2],scope:m[3]||null}:null;
}
function normalizeTargets(map){
  const out=[];
  for(const[k,ranges]of Object.entries(map||{})){
    const d=descriptor(k);
    if(!d)continue;
    const rr=[];
    for(const[a,b]of Object.entries(ranges||{})){
      if(typeof b==="string")rr.push([a,b]);
    }
    if(rr.length)out.push({provider:d.provider,id:d.id,scope:d.scope,ranges:rr});
  }
  return out;
}
function build(source){
  const shards=Array.from({length:SHARDS},()=>({}));
  let descriptors=0,targets=0,ranges=0;
  for(const[sourceKey,targetMap]of Object.entries(source||{})){
    const s=descriptor(sourceKey);
    if(!s)continue;
    const targetsForSource=normalizeTargets(targetMap).filter(x=>KEEP.has(x.provider));
    if(!targetsForSource.length)continue;
    const shard=shards[shardFor(s.provider,s.id)];
    const rec=shard[sourceKey]||(shard[sourceKey]={provider:s.provider,id:s.id,scope:s.scope,targets:[]});
    for(const t of targetsForSource){
      const old=rec.targets.find(x=>x.provider===t.provider&&x.id===t.id&&x.scope===t.scope);
      if(old)old.ranges.push(...t.ranges);
      else rec.targets.push({provider:t.provider,id:t.id,scope:t.scope,ranges:t.ranges});
      targets++;
      ranges+=t.ranges.length;
    }
    descriptors++;
  }
  return{shards,descriptors,targets,ranges};
}

exports.handler=async()=>{
  const started=Date.now();
  log("========================================");
  log("Updater START");
  try{
    const store=getStore(STORE_NAME);
    const oldMeta=await store.get(META_KEY,{type:"json"});

    if(oldMeta?.updatedAt&&Date.now()-Number(oldMeta.updatedAt)<REFRESH_MS){
      log(`SKIP mapping age=${Date.now()-Number(oldMeta.updatedAt)}ms`);
      return;
    }

    const res=await fetch(SOURCE_URL,{headers:{Accept:"application/json","User-Agent":UA}});
    log(`Source HTTP ${res.status} ok=${res.ok}`);
    if(!res.ok)throw new Error(`AniBridge HTTP ${res.status}`);

    const text=await res.text();
    log(`Downloaded bytes=${text.length}`);
    if(text.length<100000)throw new Error("AniBridge source unexpectedly small");

    const source=JSON.parse(text);
    const built=build(source);

    log(`Built descriptors=${built.descriptors} targets=${built.targets} ranges=${built.ranges}`);

    if(!built.descriptors)throw new Error("No TMDB/MAL/AniList descriptors found");

    const version=String(Date.now());
    const prefix=`v${version}`;
    const payloads=built.shards.map((x,i)=>({i,payload:JSON.stringify(x)}));

    await Promise.all(payloads.map(async({i,payload})=>{
      await store.set(`${prefix}/shard-${i}`,payload,{contentType:"application/json"});
      log(`Shard ${i+1}/${SHARDS} ${payload.length}B`);
    }));

    const verifyIndex=shardFor("tmdb_show","285993");
    const verified=await store.get(`${prefix}/shard-${verifyIndex}`,{type:"json"});
    if(!verified||typeof verified!=="object")throw new Error("New mapping verification failed");

    const meta={
      activeVersion:version,
      updatedAt:Date.now(),
      source:SOURCE_URL,
      shards:SHARDS,
      descriptors:built.descriptors,
      targets:built.targets,
      ranges:built.ranges
    };

    await store.setJSON(META_KEY,meta);
    log(`ACTIVE VERSION=${version}`);

    if(oldMeta?.activeVersion&&oldMeta.activeVersion!==version){
      await Promise.all(
        Array.from({length:SHARDS},(_,i)=>
          store.delete(`v${oldMeta.activeVersion}/shard-${i}`).catch(()=>{})
        )
      );
      log(`Old version removed=${oldMeta.activeVersion}`);
    }

    log(`SUCCESS time=${Date.now()-started}ms`);
    log("========================================");
  }catch(e){
    log("FATAL:",e?.stack||e);
    log("OLD VERSION LEFT INTACT");
    log("========================================");
    throw e;
  }
};

exports.config={schedule:"@daily"};
