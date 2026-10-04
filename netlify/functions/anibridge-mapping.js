const{getStore}=require("@netlify/blobs");

const STORE_NAME="anibridge-mapping";
const META_KEY="meta";
const SHARDS=64;
const USER_AGENT="AniKoto-Nuvio/AniBridge";

function log(...x){console.log("[ANIBRIDGE MAPPING]",...x)}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Cache-Control":"public,max-age=300"}})}
function shardFor(provider,id){let n=Number(id);if(!Number.isFinite(n))n=0;let p=provider==="tmdb_show"?1:provider==="mal"?2:provider==="anilist"?3:7;return(Math.abs(n)*31+p)%SHARDS}
function parseIntSafe(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:null}
function parseRange(s){
  const m=String(s||"").trim().match(/^(\d+)(?:-(\d*))?$/);
  if(!m)return null;
  const start=Number(m[1]),end=m[2]===""?Infinity:(m[2]?Number(m[2]):start);
  if(!Number.isInteger(start)||start<1||(!Number.isFinite(end)&&end!==Infinity)||end<start)return null;
  return{start,end};
}
function splitTarget(s){
  let raw=String(s||"").trim(),ratio=1;
  const rm=raw.match(/\|(-?\d+(?:\.\d+)?)$/);
  if(rm){ratio=Number(rm[1]);raw=raw.slice(0,-rm[0].length)}
  if(!Number.isFinite(ratio)||ratio===0)return null;
  const parts=raw.split(",").map(x=>parseRange(x)).filter(Boolean);
  return parts.length?{parts,ratio}:null;
}
function mapEpisode(sourceEpisode,sourceRange,targetRange){
  const sr=parseRange(sourceRange);
  if(!sr||sourceEpisode<sr.start||(sr.end!==Infinity&&sourceEpisode>sr.end))return null;
  const t=splitTarget(targetRange);
  if(!t)return null;

  const offset=sourceEpisode-sr.start;

  if(t.ratio>0){
    const weight=Math.max(1,t.ratio);
    const targetOffset=Math.floor(offset*weight);
    let remaining=targetOffset;
    for(const p of t.parts){
      const len=p.end===Infinity?Infinity:p.end-p.start+1;
      if(remaining<len)return p.start+remaining;
      if(len!==Infinity)remaining-=len;
      else return p.start+remaining;
    }
    return null;
  }

  const divisor=Math.abs(t.ratio);
  const targetOffset=Math.floor(offset/divisor);
  let remaining=targetOffset;
  for(const p of t.parts){
    const len=p.end===Infinity?Infinity:p.end-p.start+1;
    if(remaining<len)return p.start+remaining;
    if(len!==Infinity)remaining-=len;
    else return p.start+remaining;
  }
  return null;
}
function resolveTarget(target,episode){
  for(const[r,t]of target.ranges||[]){
    const mapped=mapEpisode(episode,r,t);
    if(mapped!==null)return mapped;
  }
  return null;
}
function findProvider(targets,provider){
  return(targets||[]).filter(x=>x.provider===provider);
}

exports.handler=async(event)=>{
  const q=event.queryStringParameters||{};
  const tmdbId=parseIntSafe(q.tmdbId);
  const season=parseIntSafe(q.season);
  const episode=parseIntSafe(q.episode);

  log(`REQUEST TMDB=${tmdbId||"?"} S${season||"?"}E${episode||"?"}`);

  if(!tmdbId||!season||!episode)return json({ok:false,error:"tmdbId,season,episode required"},400);

  try{
    const store=getStore(STORE_NAME);
    const meta=await store.get(META_KEY,{type:"json"});

    if(!meta?.activeVersion){
      return json({ok:false,error:"AniBridge mapping has not been initialized yet"},503);
    }

    const descriptor=`tmdb_show:${tmdbId}:s${season}`;
    const shard=shardFor("tmdb_show",tmdbId);
    const key=`v${meta.activeVersion}/shard-${shard}`;
    const data=await store.get(key,{type:"json"});
    const entry=data?.[descriptor];

    if(!entry){
      log(`MISS ${descriptor}`);
      return json({ok:true,source:"anibridge-v3",found:false,mapping:null});
    }

    const mal=[];
    const anilist=[];
    const other=[];

    for(const target of entry.targets||[]){
      const ep=resolveTarget(target,episode);
      if(ep===null)continue;

      const item={
        id:String(target.id),
        episode:ep,
        scope:target.scope||null
      };

      if(target.provider==="mal")mal.push(item);
      else if(target.provider==="anilist")anilist.push(item);
      else other.push({...item,provider:target.provider});
    }

    if(!mal.length&&!anilist.length){
      log(`NO MAL/ANILIST MATCH ${descriptor} E${episode}`);
      return json({ok:true,source:"anibridge-v3",found:false,mapping:null});
    }

    const mapping={
      tmdbId:String(tmdbId),
      season,
      episode,
      malId:mal[0]?.id||null,
      malEpisode:mal[0]?.episode||null,
      anilistId:anilist[0]?.id||null,
      anilistEpisode:anilist[0]?.episode||null,
      mal,
      anilist,
      other
    };

    log(`HIT ${descriptor} E${episode} MAL=${mapping.malId||"-"} E${mapping.malEpisode||"-"} ANILIST=${mapping.anilistId||"-"} E${mapping.anilistEpisode||"-"}`);

    return json({
      ok:true,
      source:"anibridge-v3",
      found:true,
      mapping
    });
  }catch(e){
    log("FATAL:",e?.stack||e);
    return json({ok:false,error:String(e?.message||e)},500);
  }
};
