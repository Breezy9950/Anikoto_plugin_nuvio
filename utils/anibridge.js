const SOURCE_URL="https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json";
const ANILIST_URL="https://graphql.anilist.co";
const CACHE_TTL=24*60*60*1000;
const META_TTL=30*24*60*60*1000;
const MAX_EPISODE=100000;
const MAX_ID_LENGTH=50;
let dataset=null;
let datasetTime=0;
const metaCache={};

function log(x){console.log("[AniBridge] "+x)}

async function fetchJson(url,opt){
  try{
    const r=await fetch(url,opt||{});
    if(!r.ok){
      log("HTTP "+r.status+" "+url);
      return null
    }
    return await r.json()
  }catch(e){
    log("Request failed "+url+": "+e.message);
    return null
  }
}

function descriptor(provider,id,scope){
  return provider+":"+id+(scope?":"+scope:"")
}

function parseDescriptor(v){
  const m=/^([^:]+):([^:]+)(?::(.+))?$/.exec(String(v||""));
  return m?{provider:m[1],id:m[2],scope:m[3]||""}:null
}

function parsePositiveInt(v){
  const n=Number(v);
  return Number.isInteger(n)&&n>0&&n<=MAX_EPISODE?n:null
}

function parseRange(v){
  const m=/^(\d+)(?:-(\d*))?$/.exec(String(v||"").trim());
  if(!m)return null;
  return{
    start:Number(m[1]),
    end:m[2]===""?Infinity:(m[2]?Number(m[2]):Number(m[1]))
  }
}

function parseTarget(v){
  let s=String(v||"").trim(),ratio=null;
  if(s.includes("|")){
    const p=s.split("|");
    s=p[0];
    ratio=Number(p[1]);
    if(!Number.isFinite(ratio)||ratio===0)ratio=null
  }
  const ranges=s.split(",").map(x=>x.trim()).filter(Boolean).map(parseRange).filter(Boolean);
  return{ranges,ratio}
}

function resolveEpisode(sourceRange,targetValue,episode){
  const sr=parseRange(sourceRange);
  if(!sr||episode<sr.start||episode>sr.end)return null;

  const target=parseTarget(targetValue);
  if(!target.ranges.length)return null;

  let offset=episode-sr.start;

  if(target.ratio&&target.ratio>0){
    offset*=target.ratio
  }else if(target.ratio&&target.ratio<0){
    offset=Math.floor(offset/Math.abs(target.ratio))
  }

  let remaining=offset;

  for(const r of target.ranges){
    const len=r.end===Infinity?Infinity:r.end-r.start+1;

    if(remaining<len){
      return Math.floor(r.start+remaining)
    }

    if(len!==Infinity){
      remaining-=len
    }else{
      return Math.floor(r.start+remaining)
    }
  }

  return null
}

function resolveTarget(mapping,episode){
  if(!mapping||typeof mapping!=="object")return null;

  for(const sourceRange of Object.keys(mapping)){
    const target=resolveEpisode(sourceRange,mapping[sourceRange],episode);
    if(Number.isInteger(target)&&target>0)return target
  }

  return null
}

function extractTargets(source,episode){
  const out=[];
  if(!source||typeof source!=="object")return out;

  for(const key of Object.keys(source)){
    const d=parseDescriptor(key);
    if(!d)continue;

    const ep=resolveTarget(source[key],episode);
    if(!Number.isInteger(ep)||ep<1)continue;

    out.push({
      descriptor:key,
      provider:d.provider,
      id:String(d.id),
      scope:d.scope,
      episode:ep
    })
  }

  return out
}

async function loadAniBridge(){
  if(dataset&&Date.now()-datasetTime<CACHE_TTL){
    log("Dataset cache HIT");
    return dataset
  }

  log("Downloading AniBridge v3 mappings from GitHub...");

  const data=await fetchJson(SOURCE_URL,{
    headers:{
      Accept:"application/json",
      "User-Agent":"AniKoto-Nuvio-AniBridge/1.0"
    }
  });

  if(!data||typeof data!=="object"||Array.isArray(data)){
    throw new Error("Invalid AniBridge dataset")
  }

  dataset=data;
  datasetTime=Date.now();

  log("AniBridge v3 dataset loaded");

  return dataset
}

async function getAniListMeta(id){
  const key=String(id);
  const cached=metaCache[key];

  if(cached&&Date.now()-cached.updatedAt<META_TTL){
    return cached
  }

  const data=await fetchJson(ANILIST_URL,{
    method:"POST",
    headers:{
      Accept:"application/json",
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      query:"query($id:Int){Media(id:$id,type:ANIME){id idMal title{romaji english native}}}",
      variables:{id:Number(id)}
    })
  });

  const media=data&&data.data&&data.data.Media;
  if(!media)return null;

  const result={
    anilist_id:String(media.id||id),
    mal_id:media.idMal?String(media.idMal):"",
    title:{
      romaji:media.title&&media.title.romaji||"",
      english:media.title&&media.title.english||"",
      native:media.title&&media.title.native||""
    },
    updatedAt:Date.now()
  };

  metaCache[key]=result;

  return result
}

async function resolveMapping(tmdbId,season,episode){
  const data=await loadAniBridge();

  const sourceKey=descriptor(
    "tmdb_show",
    tmdbId,
    "s"+season
  );

  const source=data[sourceKey];

  if(!source){
    log("TMDB season MISS "+sourceKey);
    return null
  }

  const targets=extractTargets(source,episode);

  if(!targets.length){
    log("Episode MISS "+sourceKey+" E"+episode);
    return null
  }

  const mal=targets.find(x=>x.provider==="mal")||null;
  const ani=targets.find(x=>x.provider==="anilist")||null;

  if(!mal&&!ani){
    log("No MAL/AniList target "+sourceKey+" E"+episode);
    return null
  }

  let meta=null;

  if(ani){
    meta=await getAniListMeta(ani.id)
  }

  const malId=mal?mal.id:(meta&&meta.mal_id?meta.mal_id:"");

  if(!malId){
    log("Could not resolve MAL ID "+sourceKey+" E"+episode);
    return null
  }

  const titles=[];
  const titleObj=meta&&meta.title;

  if(titleObj){
    for(const t of[
      titleObj.english,
      titleObj.romaji,
      titleObj.native
    ]){
      if(t&&titles.indexOf(t)<0)titles.push(t)
    }
  }

  const animeTitle=titleObj&&(
    titleObj.english||
    titleObj.romaji||
    titleObj.native
  )||"";

  const malEpisode=mal?mal.episode:episode;

  return{
    tmdb_id:String(tmdbId),
    tvdb_id:null,
    tvdb_season:Number(season),
    mal_id:String(malId),
    mal_episode:Number(malEpisode),
    target_episode:Number(malEpisode),
    anilist_id:ani?String(ani.id):(meta?meta.anilist_id:""),
    anime_title:animeTitle,
    titles,
    air_date:"",
    source:"anibridge",
    anibridge:{
      sourceDescriptor:sourceKey,
      targets:targets.map(x=>({
        provider:x.provider,
        id:x.id,
        scope:x.scope,
        episode:x.episode
      }))
    }
  }
}

async function getMapping(tmdbId,season,episode){
  tmdbId=String(tmdbId||"").trim();
  season=parsePositiveInt(season);
  episode=parsePositiveInt(episode);

  if(
    !/^\d+$/.test(tmdbId)||
    tmdbId.length>MAX_ID_LENGTH||
    !season||
    !episode
  ){
    return null
  }

  try{
    const mapping=await resolveMapping(tmdbId,season,episode);

    if(mapping){
      log(
        "MAPPING HIT TMDB="+tmdbId+
        " S"+season+"E"+episode+
        " -> MAL="+mapping.mal_id+
        " E"+mapping.mal_episode+
        " AniList="+(mapping.anilist_id||"?")+
        " title="+(mapping.anime_title||"?")
      )
    }

    return mapping
  }catch(e){
    log("Mapping error: "+e.message);
    return null
  }
}

module.exports={getMapping,resolveMapping};
