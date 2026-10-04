const{getStore}=require("@netlify/blobs");

const STORE_NAME="anizip-mapping-cache";
const INDEX_KEY="_index";
const CACHE_TTL=48*60*60*1000;
const ANIZIP="https://api.ani.zip";

function log(x){console.log("[ANIZIP UPDATER] "+x)}

async function req(url){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),30000);
  try{return await fetch(url,{headers:{"Accept":"application/json"},signal:c.signal})}
  finally{clearTimeout(t)}
}

async function json(url){
  try{
    const r=await req(url);
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

function cleanId(v){
  const s=String(v||"").trim();
  return s
}

async function updateEntry(store,key){
  const parts=key.split("_");
  if(parts.length!==3)return false;

  const tmdbId=parts[0];
  const season=Number(parts[1]);
  const episode=Number(parts[2]);

  if(!tmdbId||!season||!episode)return false;

  const urls=[
    ANIZIP+"/mappings?tmdb_id="+encodeURIComponent(tmdbId),
    ANIZIP+"/v1/mappings?tmdb_id="+encodeURIComponent(tmdbId)
  ];

  let data=null;

  for(const url of urls){
    data=await json(url);
    if(data)break
  }

  if(!data){
    log("FAILED "+key);
    return false
  }

  const mappings=data.mappings&&typeof data.mappings==="object"?data.mappings:data;

  const malId=cleanId(mappings.mal_id||mappings.malId);
  const anilistId=cleanId(mappings.anilist_id||mappings.anilistId);
  const tmdb=mappings.themoviedb_id||mappings.tmdb_id||mappings.tmdbId||tmdbId;

  const titles=mappings.titles&&typeof mappings.titles==="object"?mappings.titles:null;

  const title=String(
    mappings.title||
    mappings.anime_title||
    mappings.name||
    (titles&&titles.english)||
    (titles&&titles.romaji)||
    ""
  ).trim();

  if(!malId&&!anilistId){
    log("NO IDS "+key);
    return false
  }

  const old=await store.get(key,{type:"json"}).catch(()=>null);

  await store.setJSON(key,{
    savedAt:Date.now(),
    mapping:{
      malId:malId||null,
      anilistId:anilistId||null,
      tmdbId:String(tmdb),
      title:title||null,
      titles:titles||null,
      tmdbSeason:season,
      tmdbEpisode:episode
    }
  });

  log("UPDATED "+key);
  return true
}

exports.config={schedule:"@daily"};

exports.handler=async()=>{
  const store=getStore(STORE_NAME);

  const index=await store.get(INDEX_KEY,{type:"json"}).catch(()=>null);

  if(!index||!Array.isArray(index.keys)||!index.keys.length){
    log("NO INDEX - NOTHING TO REFRESH");
    return{
      statusCode:200,
      body:JSON.stringify({ok:true,updated:0,message:"No cached mappings yet"})
    }
  }

  const now=Date.now();
  let updated=0;

  for(const key of index.keys){
    const cached=await store.get(key,{type:"json"}).catch(()=>null);

    if(cached&&cached.savedAt&&now-cached.savedAt<CACHE_TTL)continue;

    if(await updateEntry(store,key))updated++;
  }

  await store.setJSON(INDEX_KEY,{
    updatedAt:now,
    keys:index.keys
  });

  log("DONE updated="+updated);

  return{
    statusCode:200,
    body:JSON.stringify({
      ok:true,
      updated,
      total:index.keys.length
    })
  }
};
