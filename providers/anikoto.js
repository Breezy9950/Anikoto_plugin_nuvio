const BASE="https://megaplay.buzz";
const MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping";
const UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";
const HEADERS={"User-Agent":UA,"Accept-Language":"en-US,en;q=0.9"};
const TIMEOUT=7000;
const CACHE_TTL=300000;

class TTLCache{
  constructor(){this.m=new Map()}
  get(k){
    const x=this.m.get(k);
    if(!x)return undefined;
    if(x.expires<=Date.now()){
      this.m.delete(k);
      return undefined;
    }
    return x.value;
  }
  set(k,v,ttl=CACHE_TTL){
    this.m.set(k,{value:v,expires:Date.now()+ttl});
    return v;
  }
  delete(k){this.m.delete(k)}
}

const CACHE=globalThis.__ANIKOTO_NUVIO_CACHE__||(globalThis.__ANIKOTO_NUVIO_CACHE__=new TTLCache());
const INFLIGHT=globalThis.__ANIKOTO_NUVIO_INFLIGHT__||(globalThis.__ANIKOTO_NUVIO_INFLIGHT__=new Map());

function log(x){
  console.log("[AniKoto] "+x);
}

function timeout(ms){
  return new Promise((_,reject)=>setTimeout(()=>reject(new Error("timeout")),ms));
}

async function req(url,opt={},ms=TIMEOUT,parentSignal=null){
  const controller=typeof AbortController==="function"?new AbortController():null;
  let timer=null;
  let onAbort=null;

  try{
    const o={
      ...opt,
      headers:{
        ...HEADERS,
        ...(opt.headers||{})
      }
    };

    if(controller){
      o.signal=controller.signal;
      timer=setTimeout(()=>controller.abort(),ms);

      if(parentSignal){
        if(parentSignal.aborted){
          controller.abort();
        }else{
          onAbort=()=>controller.abort();
          parentSignal.addEventListener("abort",onAbort,{once:true});
        }
      }
    }

    return await Promise.race([
      fetch(url,o),
      timeout(ms)
    ]);
  }catch(e){
    return null;
  }finally{
    if(timer)clearTimeout(timer);

    if(parentSignal&&onAbort){
      try{
        parentSignal.removeEventListener("abort",onAbort);
      }catch(e){}
    }
  }
}

async function json(url,opt={},ms=TIMEOUT,parentSignal=null){
  const r=await req(url,opt,ms,parentSignal);
  if(!r||!r.ok)return null;

  try{
    return await r.json();
  }catch(e){
    return null;
  }
}

// READ-ONLY mapper access. pending=1 is intentional: this provider may consume an
// existing mapping or wait for AniZone Lazy's population, but can never start population.
async function mapping(tmdbId,season,episode){
  const key="mapping:"+tmdbId+":"+season+":"+episode;

  const hit=CACHE.get(key);
  if(hit!==undefined)return hit;

  if(INFLIGHT.has(key))return INFLIGHT.get(key);

  const p=(async()=>{
    const u=MAPPING_URL+
      "?tmdb_id="+encodeURIComponent(tmdbId)+
      "&tmdbId="+encodeURIComponent(tmdbId)+
      "&season="+encodeURIComponent(season)+
      "&episode="+encodeURIComponent(episode)+
      "&pending=1";

    const d=await json(
      u,
      {
        headers:{
          "Accept":"application/json"
        }
      },
      4500
    );

    if(!d||!d.ok||!d.mapping)return null;

    const m=d.mapping;

    const malId=String(
      m.mal_id??
      m.malId??
      ""
    ).trim();

    const malEpisode=Number(
      m.mal_episode??
      m.target_episode??
      m.malEpisode??
      m.episode??
      0
    );

    if(
      !malId||
      !Number.isFinite(malEpisode)||
      malEpisode<1
    ){
      return null;
    }

    return{
      malId,
      malEpisode,
      title:String(
        m.anime_title||
        m.mal_title||
        m.title||
        m.name||
        "Anime"
      ).trim(),
      episodeTitle:String(
        m.episode_title||
        m.title||
        "Episode "+malEpisode
      ).trim()
    };
  })();

  INFLIGHT.set(key,p);

  try{
    const v=await p;

    if(v){
      CACHE.set(key,v);
    }

    return v;
  }finally{
    INFLIGHT.delete(key);
  }
}

function streamUrl(malId,episode,audio){
  return BASE+
    "/stream/mal/"+
    encodeURIComponent(malId)+
    "/"+
    encodeURIComponent(episode)+
    "/"+
    audio;
}

async function extractStream(pageUrl,mode,signal=null){
  const page=await req(
    pageUrl,
    {
      headers:{
        Referer:BASE+"/"
      }
    },
    5500,
    signal
  );

  if(!page||!page.ok)return null;

  let html="";

  try{
    html=await page.text();
  }catch(e){
    return null;
  }

  let match=html.match(
    /data-id=["'](\d+)["']/i
  );

  if(!match){
    const iframe=html.match(
      /<iframe[^>]+src=["']([^"']+)["']/i
    );

    if(iframe){
      const src=
        iframe[1].startsWith("http")
          ?iframe[1]
          :BASE+iframe[1];

      const ir=await req(
        src,
        {
          headers:{
            Referer:pageUrl
          }
        },
        4000,
        signal
      );

      if(ir&&ir.ok){
        try{
          const it=await ir.text();

          match=it.match(
            /data-id=["'](\d+)["']/i
          );
        }catch(e){}
      }
    }
  }

  if(!match)return null;

  const id=match[1];

  const sourceUrl=
    BASE+
    "/stream/getSources?id="+
    id;

  const data=await json(
    sourceUrl,
    {
      headers:{
        "X-Requested-With":"XMLHttpRequest",
        "Referer":pageUrl
      }
    },
    4500,
    signal
  );

  if(
    !data||
    !data.sources||
    !data.sources.file
  ){
    return null;
  }

  const subtitles=[];

  if(Array.isArray(data.tracks)){
    for(const t of data.tracks){
      if(!t)continue;

      const kind=String(
        t.kind||
        t.type||
        ""
      ).toLowerCase();

      if(
        (
          kind==="captions"||
          kind==="subtitles"
        )&&
        t.file
      ){
        subtitles.push({
          id:String(
            t.label||
            t.name||
            "English"
          ),
          url:String(t.file),
          language:"eng"
        });
      }
    }
  }

  // Do not fetch the master playlist just to measure resolution.
  // That extra request delays playback; Nuvio can start the returned
  // HLS stream directly.
  return{
    url:String(data.sources.file),
    quality:"1080p",
    subtitles,
    headers:{
      Referer:BASE+"/",
      Origin:BASE
    }
  };
}

function firstSuccessful(tasks){
  return new Promise(resolve=>{
    let left=tasks.length;

    if(!left){
      return resolve(null);
    }

    const controller=
      typeof AbortController==="function"
        ?new AbortController()
        :null;

    let settled=false;

    const finish=v=>{
      if(settled)return;

      if(v){
        settled=true;

        // The first valid stream has won.
        // Abort every remaining extraction immediately.
        if(controller){
          controller.abort();
        }

        resolve(v);
        return;
      }

      left--;

      if(left<=0){
        settled=true;
        resolve(null);
      }
    };

    for(const task of tasks){
      Promise
        .resolve()
        .then(()=>{
          return task(
            controller&&controller.signal
          );
        })
        .then(finish)
        .catch(()=>{
          finish(null);
        });
    }
  });
}

async function resolve(
  tmdbId,
  mediaType,
  season,
  episode
){
  const type=String(
    mediaType||"tv"
  ).toLowerCase();

  const id=String(
    tmdbId||""
  ).trim();

  const s=Number(season)||1;
  const e=Number(episode)||1;

  if(!id)return[];

  // AniKoto is intentionally mapper-only.
  // Movies are also sent through the current mapper;
  // no independent TMDB/MAL/AniList resolution is performed here.
  const map=await mapping(
    id,
    type==="movie"?1:s,
    type==="movie"?1:e
  );

  if(!map){
    log(
      "MAPPER MISS "+
      id+
      " S"+
      s+
      "E"+
      e
    );
    return[];
  }

  const key=
    "stream:"+
    id+
    ":"+
    type+
    ":"+
    s+
    ":"+
    e;

  const cached=CACHE.get(key);

  if(cached!==undefined){
    return cached;
  }

  // SUB and DUB are probed simultaneously.
  // The first complete valid stream wins.
  // Once one wins, the shared AbortController cancels
  // the losing extraction so we do not continue waiting
  // for a second stream.
  const result=await firstSuccessful([
    signal=>
      extractStream(
        streamUrl(
          map.malId,
          map.malEpisode,
          "sub"
        ),
        "sub",
        signal
      ).then(x=>
        x
          ?{
              x,
              mode:"sub"
            }
          :null
      ),

    signal=>
      extractStream(
        streamUrl(
          map.malId,
          map.malEpisode,
          "dub"
        ),
        "dub",
        signal
      ).then(x=>
        x
          ?{
              x,
              mode:"dub"
            }
          :null
      )
  ]);

  if(!result)return[];

  const x=result.x;

  const audio=
    result.mode==="sub"
      ?"Japanese (SUB)"
      :"English (DUB)";

  const title=
    map.title||
    "Anime";

  const epTitle=
    map.episodeTitle||
    ("Episode "+map.malEpisode);

  const stream={
    name:"AniKotoTV",

    title:
      type==="movie"
        ?"🎦 "+title+" | "+audio
        :"🎦 "+title+
         "\n🎬 S"+s+
         "E"+e+
         " - "+
         epTitle+
         "\n✨ "+
         audio,

    size:title,
    description:title,
    url:x.url,
    quality:x.quality,
    subtitles:x.subtitles,
    headers:x.headers
  };

  CACHE.set(
    key,
    [stream],
    30000
  );

  log(
    "FIRST STREAM "+
    result.mode.toUpperCase()+
    " MAL="+
    map.malId+
    " E"+
    map.malEpisode
  );

  return[stream];
}

async function getStreams(
  tmdbId,
  mediaType="tv",
  season=1,
  episode=1,
  settings={}
){
  try{
    return await resolve(
      tmdbId,
      mediaType,
      season,
      episode
    );
  }catch(e){
    log(
      "ERROR "+
      String(e)
    );
    return[];
  }
}

function search(){
  return[];
}

function getCatalog(){
  return[];
}

function getItemDetails(){
  return[];
}

if(
  typeof module!=="undefined"&&
  module.exports
){
  module.exports={
    getStreams,
    search,
    getCatalog,
    getItemDetails
  };
}else if(
  typeof global!=="undefined"
){
  global.getStreams=getStreams;
}
