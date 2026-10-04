const{getStore}=require("@netlify/blobs");

const STORE_NAME="anibridge-mapping-cache";
const MAPPING_KEY="anibridge-v3-mappings";
const META_KEY="anibridge-v3-meta";
const SOURCE_URL="https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json";
const ANILIST_URL="https://graphql.anilist.co";
const CACHE_TTL=48*60*60*1000;
const FETCH_TIMEOUT=120000;
const MAX_ID_LENGTH=50;
const MAX_EPISODE=100000;

function log(message){
  console.log(`[ANIBRIDGE MAPPING] ${message}`);
}

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

function cleanId(value){
  const s=String(value||"").trim();
  return s&&s.length<=MAX_ID_LENGTH?s:null;
}

function fetchWithTimeout(url,options={},timeoutMs=FETCH_TIMEOUT){
  const timer={id:null};
  const timeout=new Promise((_,reject)=>{
    timer.id=setTimeout(()=>reject(new Error("Timeout")),timeoutMs);
  });
  return Promise.race([
    fetch(url,options),
    timeout
  ]).finally(()=>{
    if(timer.id!==null)clearTimeout(timer.id);
  });
}

function validateMappingData(data){
  if(!data||typeof data!=="object"||Array.isArray(data))throw new Error("AniBridge mapping is not a JSON object");

  const keys=Object.keys(data);
  if(!keys.length)throw new Error("AniBridge mapping is empty");

  const sample=keys.find(k=>k.startsWith("tmdb_show:"));
  if(!sample)throw new Error("AniBridge mapping contains no tmdb_show descriptors");

  const source=data[sample];
  if(!source||typeof source!=="object"||Array.isArray(source))throw new Error("AniBridge descriptor structure is invalid");

  return true;
}

async function downloadFreshMapping(){
  log(`Downloading ${SOURCE_URL}`);

  const response=await fetchWithTimeout(SOURCE_URL,{
    headers:{
      "Accept":"application/json",
      "User-Agent":"Breezy-Plugins-AniBridge/1.0"
    }
  });

  if(!response.ok)throw new Error(`AniBridge GitHub HTTP ${response.status}`);

  const text=await response.text();

  if(!text||text.length<100)throw new Error("AniBridge download is empty or too small");

  log(`Downloaded ${text.length} characters`);

  let data;
  try{
    data=JSON.parse(text);
  }catch(error){
    throw new Error(`AniBridge JSON parse failed: ${error.message}`);
  }

  validateMappingData(data);

  return{
    data,
    bytes:text.length
  };
}

function parseSourceRange(value){
  const s=String(value||"").trim();

  if(!s)return null;

  const match=s.match(/^(\d+)(?:-(\d+))?$/);

  if(!match)return null;

  const start=Number(match[1]);
  const end=match[2]===undefined?start:Number(match[2]);

  if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start)return null;

  return{start,end};
}

function parseTargetSegment(value){
  const s=String(value||"").trim();

  const ratioParts=s.split("|");

  const rangePart=ratioParts[0];
  const ratio=ratioParts.length>1?Number(ratioParts[ratioParts.length-1]):1;

  if(!Number.isFinite(ratio)||ratio===0)return null;

  const ranges=String(rangePart).split(",").map(parseSourceRange).filter(Boolean);

  if(!ranges.length)return null;

  return{ranges,ratio};
}

function mapEpisode(sourceEpisode,targetValue){
  const wanted=Number(sourceEpisode);

  if(!Number.isInteger(wanted)||wanted<1)return null;

  const parsed=parseTargetSegment(targetValue);

  if(!parsed)return null;

  const sourceStart=sourceEpisode;

  if(parsed.ratio===1){
    let offset=0;

    for(const range of parsed.ranges){
      const length=range.end-range.start+1;

      if(offset<=0&&sourceStart===sourceStart){
        if(sourceStart>=1&&sourceStart<=length)return range.start+sourceStart-1;
      }

      offset+=length;
    }
  }

  return null;
}

function resolveEpisode(mapping,episode){
  if(!mapping||typeof mapping!=="object")return null;

  const wanted=Number(episode);

  if(!Number.isInteger(wanted)||wanted<1)return null;

  for(const sourceRangeKey of Object.keys(mapping)){
    const sourceRange=parseSourceRange(sourceRangeKey);

    if(!sourceRange)continue;

    if(wanted<sourceRange.start||wanted>sourceRange.end)continue;

    const targetValue=mapping[sourceRangeKey];

    if(typeof targetValue!=="string")continue;

    const parsed=String(targetValue).split("|");
    const ratio=parsed.length>1?Number(parsed[parsed.length-1]):1;

    if(!Number.isFinite(ratio)||ratio===0)continue;

    const targetRanges=String(parsed[0])
      .split(",")
      .map(parseSourceRange)
      .filter(Boolean);

    if(!targetRanges.length)continue;

    const sourceOffset=wanted-sourceRange.start;

    if(ratio===1){
      let remaining=sourceOffset;

      for(const target of targetRanges){
        const length=target.end-target.start+1;

        if(remaining<length){
          return target.start+remaining;
        }

        remaining-=length;
      }

      continue;
    }

    if(ratio>0){
      const targetOffset=Math.floor(sourceOffset*ratio);
      let remaining=targetOffset;

      for(const target of targetRanges){
        const length=target.end-target.start+1;

        if(remaining<length){
          return target.start+remaining;
        }

        remaining-=length;
      }

      continue;
    }

    if(ratio<0){
      const divisor=Math.abs(ratio);
      const targetOffset=Math.floor(sourceOffset/divisor);
      let remaining=targetOffset;

      for(const target of targetRanges){
        const length=target.end-target.start+1;

        if(remaining<length){
          return target.start+remaining;
        }

        remaining-=length;
      }
    }
  }

  return null;
}

async function getAniListMeta(anilistId){
  try{
    const response=await fetchWithTimeout(ANILIST_URL,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Accept":"application/json",
        "User-Agent":"Breezy-Plugins-AniBridge/1.0"
      },
      body:JSON.stringify({
        query:"query($id:Int){Media(id:$id,type:ANIME){id,idMal,title{romaji,english,native}}}",
        variables:{id:Number(anilistId)}
      })
    },10000);

    if(!response.ok){
      log(`AniList HTTP ${response.status}`);
      return null;
    }

    const body=await response.json();
    const media=body?.data?.Media;

    if(!media)return null;

    const title=String(
      media.title?.english||
      media.title?.romaji||
      media.title?.native||
      ""
    ).trim();

    const titles=[
      media.title?.english,
      media.title?.romaji,
      media.title?.native
    ].filter(Boolean).map(String);

    return{
      malId:media.idMal?String(media.idMal):null,
      title,
      titles
    };
  }catch(error){
    log(`AniList lookup failed: ${error.message}`);
    return null;
  }
}

function findTargetDescriptor(source,targetProvider){
  const wanted=String(targetProvider||"").toLowerCase();

  for(const descriptor of Object.keys(source||{})){
    if(String(descriptor).toLowerCase().startsWith(`${wanted}:`)){
      return descriptor;
    }
  }

  return null;
}

async function resolveMapping(data,tmdbId,season,episode){
  const key=`tmdb_show:${tmdbId}:s${season}`;
  const source=data?.[key];

  if(!source){
    log(`No AniBridge descriptor: ${key}`);
    return null;
  }

  const malDescriptor=findTargetDescriptor(source,"mal");

  if(malDescriptor){
    const malId=cleanId(malDescriptor.split(":")[1]);
    const malEpisode=resolveEpisode(source[malDescriptor],episode);

    if(malId&&malEpisode){
      let title="";
      let titles=[];

      const anilistDescriptor=findTargetDescriptor(source,"anilist");

      if(anilistDescriptor){
        const anilistId=cleanId(anilistDescriptor.split(":")[1]);

        if(anilistId){
          const meta=await getAniListMeta(anilistId);

          if(meta){
            title=meta.title||"";
            titles=meta.titles||[];
          }
        }
      }

      return{
        malId,
        malEpisode,
        title,
        titles
      };
    }
  }

  const anilistDescriptor=findTargetDescriptor(source,"anilist");

  if(anilistDescriptor){
    const anilistId=cleanId(anilistDescriptor.split(":")[1]);
    const anilistEpisode=resolveEpisode(source[anilistDescriptor],episode);

    if(anilistId&&anilistEpisode){
      const meta=await getAniListMeta(anilistId);

      if(meta?.malId){
        return{
          malId:meta.malId,
          malEpisode:anilistEpisode,
          title:meta.title||"",
          titles:meta.titles||[]
        };
      }
    }
  }

  log(`No MAL/AniList episode mapping for ${key} E${episode}`);

  return null;
}

async function readCachedMapping(store){
  try{
    const meta=await store.get(META_KEY,{
      type:"json",
      consistency:"strong"
    });

    if(!meta||!meta.updatedAt)return null;

    const age=Date.now()-Number(meta.updatedAt);

    const data=await store.get(MAPPING_KEY,{
      type:"json",
      consistency:"strong"
    });

    if(!data){
      log("Metadata exists but mapping blob is missing");
      return null;
    }

    return{
      data,
      updatedAt:Number(meta.updatedAt),
      fresh:age<CACHE_TTL
    };
  }catch(error){
    log(`Cache read failed: ${error.message}`);
    return null;
  }
}

async function replaceCachedMapping(store,data,bytes){
  const tempKey=`${MAPPING_KEY}-pending`;

  log("Writing new AniBridge mapping to temporary cache");

  await store.setJSON(tempKey,data);

  const verification=await store.get(tempKey,{
    type:"json",
    consistency:"strong"
  });

  validateMappingData(verification);

  log("Temporary AniBridge mapping verified");

  await store.setJSON(MAPPING_KEY,verification);

  await store.setJSON(META_KEY,{
    version:"v3",
    updatedAt:Date.now(),
    source:SOURCE_URL,
    bytes
  });

  try{
    await store.delete(tempKey);
  }catch(error){
    log(`Temporary cache cleanup failed: ${error.message}`);
  }

  log("AniBridge cache replaced successfully");
}

async function getUsableMapping(store){
  const cached=await readCachedMapping(store);

  if(cached?.fresh){
    log("Using cached AniBridge mapping");
    return cached.data;
  }

  if(cached?.data){
    log("AniBridge cache expired; attempting safe refresh");

    try{
      const fresh=await downloadFreshMapping();

      await replaceCachedMapping(
        store,
        fresh.data,
        fresh.bytes
      );

      return fresh.data;
    }catch(error){
      log(`Refresh failed; keeping old AniBridge mapping: ${error.message}`);
      return cached.data;
    }
  }

  log("No AniBridge cache exists; downloading initial mapping");

  const fresh=await downloadFreshMapping();

  await replaceCachedMapping(
    store,
    fresh.data,
    fresh.bytes
  );

  return fresh.data;
}

exports.handler=async(event)=>{
  if(event?.httpMethod==="OPTIONS"){
    return json(204,{});
  }

  const started=Date.now();

  try{
    const params=event?.queryStringParameters||{};

    const tmdbId=cleanId(params.tmdbId);
    const season=parsePositiveInt(params.season);
    const episode=parsePositiveInt(params.episode);

    if(!tmdbId||!season||!episode){
      return json(400,{
        ok:false,
        error:"tmdbId, season and episode are required"
      });
    }

    log(`REQUEST TMDB=${tmdbId} S${season}E${episode}`);

    const store=getStore(STORE_NAME);

    const data=await getUsableMapping(store);

    const mapping=await resolveMapping(
      data,
      tmdbId,
      season,
      episode
    );

    if(!mapping){
      log(`MISS TMDB=${tmdbId} S${season}E${episode}`);

      return json(404,{
        ok:false,
        tmdbId,
        season,
        episode,
        error:"No AniBridge mapping found"
      });
    }

    log(`HIT TMDB=${tmdbId} S${season}E${episode} -> MAL=${mapping.malId} E${mapping.malEpisode} (${Date.now()-started}ms)`);

    return json(200,{
      ok:true,
      source:"anibridge-v3",
      cacheTtlHours:48,
      mapping:{
        malId:mapping.malId,
        malEpisode:mapping.malEpisode,
        title:mapping.title,
        titles:mapping.titles
      }
    });
  }catch(error){
    log(`FATAL: ${error.message}`);

    return json(500,{
      ok:false,
      error:"AniBridge mapping service failed",
      message:String(error.message||error)
    });
  }
};
