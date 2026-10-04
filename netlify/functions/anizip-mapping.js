const{getStore}=require("@netlify/blobs");

const STORE_NAME="anizip-mapping-cache";
const CACHE_TTL=48*60*60*1000;
const ANIZIP="https://api.ani.zip";

function log(x){console.log("[ANIZIP MAPPING] "+x)}

async function req(url,opt={}){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);
  try{return await fetch(url,Object.assign({},opt,{signal:c.signal,headers:Object.assign({"Accept":"application/json"},opt.headers||{})}))}
  finally{clearTimeout(t)}
}

async function json(url,opt={}){
  try{
    const r=await req(url,opt);
    if(!r.ok){
      log("HTTP "+r.status+" "+url);
      return null
    }
    return await r.json()
  }catch(e){
    log("REQUEST ERROR "+e.message);
    return null
  }
}

function num(v){
  const n=Number(v);
  return Number.isFinite(n)&&n>0?n:null
}

function str(v){
  return v===undefined||v===null?"":String(v).trim()
}

function pick(...v){
  for(const x of v){
    const s=str(x);
    if(s)return s
  }
  return""
}

function findId(d,names){
  if(!d||typeof d!=="object")return null;
  for(const n of names){
    const v=d[n];
    const x=num(v);
    if(x!==null)return x
  }
  return null
}

function findString(d,names){
  if(!d||typeof d!=="object")return"";
  for(const n of names){
    const v=str(d[n]);
    if(v)return v
  }
  return""
}

function normalizeMappings(d){
  if(!d||typeof d!=="object")return null;

  const root=d.mappings&&typeof d.mappings==="object"?d.mappings:d;

  const malId=findId(root,["mal_id","malId","myanimelist_id"]);
  const anilistId=findId(root,["anilist_id","anilistId","aniListId"]);
  const tmdbId=findString(root,["themoviedb_id","tmdb_id","tmdbId"]);
  const imdbId=findString(root,["imdb_id","imdbId"]);
  const kitsuId=findId(root,["kitsu_id","kitsuId"]);
  const tvdbId=findId(root,["thetvdb_id","tvdb_id","tvdbId"]);

  const titles=root.titles&&typeof root.titles==="object"?root.titles:{};
  const title=pick(
    root.title,
    root.anime_title,
    root.name,
    titles.english,
    titles.romaji,
    titles.japanese
  );

  const out={
    malId:malId?String(malId):null,
    anilistId:anilistId?String(anilistId):null,
    tmdbId:tmdbId||null,
    imdbId:imdbId||null,
    kitsuId:kitsuId?String(kitsuId):null,
    tvdbId:tvdbId?String(tvdbId):null,
    title:title||null,
    titles:Object.keys(titles).length?titles:null
  };

  if(!out.malId&&!out.anilistId)return null;
  return out
}

function extractEpisodeMappings(d,season,episode){
  if(!d||typeof d!=="object")return[];

  const arrays=[
    d.episodes,
    d.episodeMappings,
    d.episode_mappings,
    d.mappings
  ].filter(Array.isArray);

  const out=[];

  for(const arr of arrays){
    for(const x of arr){
      if(!x||typeof x!=="object")continue;

      const s=num(x.season)||num(x.seasonNumber)||num(x.season_number);
      const e=num(x.episode)||num(x.episodeNumber)||num(x.episode_number)||num(x.tmdbEpisode)||num(x.tmdb_episode);

      if(s&&s!==Number(season))continue;
      if(e&&e!==Number(episode))continue;

      out.push(x)
    }
  }

  return out
}

function extractTargetEpisode(d,season,episode){
  const candidates=[];

  function add(x){
    if(x===undefined||x===null)return;
    const n=num(x);
    if(n!==null)candidates.push(n)
  }

  if(d&&typeof d==="object"){
    add(d.mal_episode);
    add(d.malEpisode);
    add(d.target_episode);
    add(d.targetEpisode);
    add(d.episode);
    add(d.episodeNumber);

    if(d.mapping&&typeof d.mapping==="object"){
      add(d.mapping.mal_episode);
      add(d.mapping.malEpisode);
      add(d.mapping.target_episode);
      add(d.mapping.targetEpisode);
    }
  }

  return candidates.length?candidates[0]:null
}

async function fetchMappingsByTmdb(tmdbId,season,episode){
  const urls=[
    ANIZIP+"/mappings?tmdb_id="+encodeURIComponent(tmdbId),
    ANIZIP+"/v1/mappings?tmdb_id="+encodeURIComponent(tmdbId)
  ];

  for(const u of urls){
    const d=await json(u);
    if(d)return d
  }

  return null
}

async function fetchEpisodes(anilistId){
  const urls=[
    ANIZIP+"/v1/episodes?anilist_id="+encodeURIComponent(anilistId),
    ANIZIP+"/episodes?anilist_id="+encodeURIComponent(anilistId)
  ];

  for(const u of urls){
    const d=await json(u);
    if(d)return d
  }

  return null
}

async function resolve(tmdbId,season,episode){
  const raw=await fetchMappingsByTmdb(tmdbId,season,episode);
  if(!raw)return null;

  const mapping=normalizeMappings(raw);
  if(!mapping)return null;

  let malEpisode=null;

  const em=extractEpisodeMappings(raw,season,episode);
  for(const x of em){
    const n=extractTargetEpisode(x,season,episode);
    if(n){
      malEpisode=n;
      break
    }
  }

  if(!malEpisode&&mapping.anilistId){
    const eps=await fetchEpisodes(mapping.anilistId);
    if(eps&&eps.episodes){
      const wanted=Number(episode);
      const values=Array.isArray(eps.episodes)?eps.episodes:Object.values(eps.episodes);

      for(const x of values){
        if(!x||typeof x!=="object")continue;

        const s=num(x.seasonNumber)||num(x.season)||null;
        const e=num(x.episodeNumber)||num(x.episode)||null;

        if(s&&s!==Number(season))continue;
        if(e&&e!==wanted)continue;

        const n=num(x.malEpisode)||num(x.mal_episode)||num(x.absoluteEpisodeNumber);
        if(n){
          malEpisode=n;
          break
        }
      }
    }
  }

  if(!malEpisode)malEpisode=Number(episode);

  return{
    malId:mapping.malId,
    malEpisode,
    anilistId:mapping.anilistId,
    title:mapping.title,
    titles:mapping.titles,
    tmdbId:String(tmdbId),
    tmdbSeason:Number(season),
    tmdbEpisode:Number(episode),
    imdbId:mapping.imdbId,
    kitsuId:mapping.kitsuId,
    tvdbId:mapping.tvdbId
  }
}

exports.handler=async(event)=>{
  try{
    const p=event.queryStringParameters||{};
    const tmdbId=str(p.tmdbId||p.tmdb_id);
    const season=num(p.season);
    const episode=num(p.episode);

    if(!tmdbId||!season||!episode){
      return{
        statusCode:400,
        headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
        body:JSON.stringify({ok:false,error:"tmdbId, season and episode are required"})
      }
    }

    log("REQUEST RECEIVED TMDB="+tmdbId+" S"+season+"E"+episode);

    const key=tmdbId+"_"+season+"_"+episode;
    const store=getStore(STORE_NAME);

    const cached=await store.get(key,{type:"json"}).catch(()=>null);

    if(cached&&cached.savedAt&&Date.now()-cached.savedAt<CACHE_TTL&&cached.mapping){
      log("CACHE HIT TMDB="+tmdbId+" S"+season+"E"+episode);
      return{
        statusCode:200,
        headers:{"Content-Type":"application/json","Cache-Control":"public,max-age=3600"},
        body:JSON.stringify({
          ok:true,
          found:true,
          source:"anizip",
          cached:true,
          mapping:cached.mapping
        })
      }
    }

    const mapping=await resolve(tmdbId,season,episode);

    if(!mapping){
      log("MAPPING MISS TMDB="+tmdbId+" S"+season+"E"+episode);
      return{
        statusCode:200,
        headers:{"Content-Type":"application/json","Cache-Control":"public,max-age=300"},
        body:JSON.stringify({ok:true,found:false,source:"anizip",mapping:null})
      }
    }

    await store.setJSON(key,{savedAt:Date.now(),mapping}).catch(e=>log("CACHE WRITE ERROR "+e.message));

    log("MAPPING HIT TMDB="+tmdbId+" MAL="+mapping.malId+" E"+mapping.malEpisode);

    return{
      statusCode:200,
      headers:{"Content-Type":"application/json","Cache-Control":"public,max-age=3600"},
      body:JSON.stringify({
        ok:true,
        found:true,
        source:"anizip",
        cached:false,
        mapping
      })
    }
  }catch(e){
    log("FATAL "+e.message);
    return{
      statusCode:500,
      headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
      body:JSON.stringify({ok:false,error:e.message})
    }
  }
};
