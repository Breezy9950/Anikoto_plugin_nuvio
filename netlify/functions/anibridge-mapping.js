const{getStore}=require("@netlify/blobs");

const STORE_NAME="anibridge-mapping";
const META_KEY="meta";
const SHARDS=16;

function log(...x){console.log("[ANIBRIDGE MAPPING]",...x)}
function json(x,status=200){return{statusCode:status,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Cache-Control":"public,max-age=300"},body:JSON.stringify(x)}}
function shardFor(provider,id){let n=Number(id)||0,p=provider==="tmdb_show"?1:provider==="tmdb_movie"?2:provider==="mal"?3:4;return(Math.abs(n)*31+p)%SHARDS}
function num(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:null}
function range(s){
  const m=String(s||"").trim().match(/^(\d+)(?:-(\d*))?$/);
  if(!m)return null;
  const a=Number(m[1]),b=m[2]===""?Infinity:(m[2]?Number(m[2]):a);
  if(a<1||b<a)return null;
  return{a,b};
}
function targetParts(s){
  let raw=String(s||"").trim(),ratio=1;
  const m=raw.match(/\|(-?\d+(?:\.\d+)?)$/);
  if(m){ratio=Number(m[1]);raw=raw.slice(0,-m[0].length)}
  const parts=raw.split(",").map(range).filter(Boolean);
  return parts.length?{parts,ratio}:null;
}
function mapEpisode(ep,source,target){
  const sr=range(source);
  if(!sr||ep<sr.a||(sr.b!==Infinity&&ep>sr.b))return null;
  const t=targetParts(target);
  if(!t||!Number.isFinite(t.ratio)||t.ratio===0)return null;
  let offset=ep-sr.a;
  if(t.ratio>0)offset=Math.floor(offset*t.ratio);
  else offset=Math.floor(offset/Math.abs(t.ratio));
  for(const p of t.parts){
    const len=p.b===Infinity?Infinity:p.b-p.a+1;
    if(offset<len)return p.a+offset;
    if(len!==Infinity)offset-=len;
  }
  return null;
}
function resolveTarget(t,episode){
  if(episode==null)return null;
  for(const[r,to]of t.ranges||[]){
    const ep=mapEpisode(episode,r,to);
    if(ep!==null)return ep;
  }
  return null;
}

exports.handler=async(event)=>{
  const q=event.queryStringParameters||{};
  let provider=q.provider;
  let id=q.id;

  const tmdbId=num(q.tmdbId);
  const season=num(q.season);
  const episode=num(q.episode);

  if(tmdbId){
    provider="tmdb_show";
    id=String(tmdbId);
  }

  if(!provider||!id)return json({ok:false,error:"tmdbId or provider+id required"},400);

  const allowed=new Set(["tmdb_show","tmdb_movie","mal","anilist"]);
  if(!allowed.has(provider))return json({ok:false,error:"unsupported provider"},400);

  try{
    const store=getStore(STORE_NAME,{
      siteID:process.env.NETLIFY_SITE_ID,
      token:process.env.NETLIFY_AUTH_TOKEN
    });

    const meta=await store.get(META_KEY,{type:"json"});

    if(!meta?.activeVersion){
      return json({ok:false,error:"mapping not initialized"},503);
    }

    const descriptor=provider==="tmdb_show"&&season
      ?`tmdb_show:${id}:s${season}`
      :`${provider}:${id}`;

    const shard=shardFor(provider,id);
    const data=await store.get(`v${meta.activeVersion}/shard-${shard}`,{type:"json"});
    const entry=data?.[descriptor];

    if(!entry){
      log(`MISS ${descriptor}`);
      return json({ok:true,found:false,mapping:null});
    }

    const result={
      provider,
      id:String(id),
      scope:entry.scope||null,
      targets:[]
    };

    for(const t of entry.targets||[]){
      const mappedEpisode=episode?resolveTarget(t,episode):null;
      result.targets.push({
        provider:t.provider,
        id:String(t.id),
        scope:t.scope||null,
        episode:mappedEpisode,
        ranges:t.ranges
      });
    }

    const mal=result.targets.filter(x=>x.provider==="mal");
    const anilist=result.targets.filter(x=>x.provider==="anilist");
    const tmdb=result.targets.filter(x=>x.provider==="tmdb_show"||x.provider==="tmdb_movie");

    const mapping={
      malId:mal[0]?.id||null,
      malEpisode:mal[0]?.episode||null,
      anilistId:anilist[0]?.id||null,
      anilistEpisode:anilist[0]?.episode||null,
      tmdbId:tmdb[0]?.id||null,
      tmdbEpisode:tmdb[0]?.episode||null,
      targets:result.targets
    };

    log(`HIT ${descriptor}${episode?` E${episode}`:""} MAL=${mapping.malId||"-"} ANILIST=${mapping.anilistId||"-"} TMDB=${mapping.tmdbId||"-"}`);

    return json({
      ok:true,
      found:true,
      source:"anibridge-v3",
      activeVersion:meta.activeVersion,
      mapping
    });
  }catch(e){
    log("FATAL:",e?.stack||e);
    return json({ok:false,error:String(e?.message||e)},500);
  }
};
