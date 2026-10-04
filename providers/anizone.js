const BASE="https://anizone.to";
const MAPPING_URL="https://breezy-plugins.netlify.app/.netlify/functions/anime-mapping";
const UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";

function log(x){console.log("[AniZone] "+x)}

async function req(url,opt){
  opt=opt||{};
  const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);
  try{return await fetch(url,Object.assign({},opt,{signal:c.signal}))}
  finally{clearTimeout(t)}
}

async function text(url,opt){
  try{
    const r=await req(url,opt);
    if(!r.ok){log("HTTP "+r.status+" "+url);return null}
    return await r.text()
  }catch(e){
    log("Request failed "+url+": "+e.message);
    return null
  }
}

async function json(url,opt){
  try{
    const r=await req(url,opt);
    if(!r.ok){log("HTTP "+r.status+" "+url);return null}
    return await r.json()
  }catch(e){
    log("JSON request failed "+url+": "+e.message);
    return null
  }
}

function decode(s){
  return String(s||"")
    .replace(/\\u0022/g,'"')
    .replace(/\\u0027/g,"'")
    .replace(/\\\//g,"/")
    .replace(/\\\\/g,"\\")
}

function parseJsonData(s){
  try{return JSON.parse(decode(s))}
  catch(e){
    try{return JSON.parse(decode(s).replace(/&quot;/g,'"').replace(/&#039;/g,"'"))}
    catch(e2){return null}
  }
}

function extractJsonParse(html,near){
  const re=near
    ? new RegExp(near+"\\s*:\\s*JSON\\.parse\\('([\\s\\S]*?)'\\)")
    : /JSON\.parse\('([\s\S]*?)'\)/;
  const m=re.exec(html||"");
  return m?parseJsonData(m[1]):null
}

async function mapping(tmdbId,season,episode){
  const u=MAPPING_URL+"?tmdbId="+encodeURIComponent(tmdbId)+"&season="+encodeURIComponent(season)+"&episode="+encodeURIComponent(episode);
  const d=await json(u,{headers:{"Accept":"application/json","User-Agent":UA}});
  if(!d||!d.ok||!d.mapping)return null;
  const m=d.mapping;
  const mal=String(m.mal_id||m.malId||"").trim();
  const ep=Number(m.mal_episode||m.target_episode||0);
  if(!mal||!ep)return null;
  return{
    malId:mal,
    malEpisode:ep,
    title:String(m.anime_title||"").trim(),
    titles:Array.isArray(m.titles)?m.titles.filter(Boolean).map(String):[]
  }
}

async function search(query){
  query=String(query||"").trim();
  if(!query)return[];
  const url=BASE+"/anime?search="+encodeURIComponent(query);
  const html=await text(url,{headers:{"User-Agent":UA,"Accept":"text/html,application/xhtml+xml"}});
  if(!html)return[];
  const data=extractJsonParse(html,null);
  if(!Array.isArray(data))return[];
  return data.map(x=>({
    name:x.main_title||"",
    alias:String(x.url||"").replace(/\\/g,""),
    imageUrl:x.cover||""
  })).filter(x=>x.name&&x.alias)
}

function normalize(s){
  return String(s||"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g,"").trim()
}

async function findAnime(m){
  const queries=[m.title,...m.titles].filter(Boolean);
  const all=[];
  for(const q of queries){
    const rs=await search(q);
    for(const x of rs)if(!all.some(y=>y.alias===x.alias))all.push(x);
    const exact=rs.find(x=>x.name===q);
    if(exact)return exact
  }
  for(const q of queries){
    const n=normalize(q);
    const exact=all.find(x=>normalize(x.name)===n);
    if(exact)return exact
  }
  return all[0]||null
}

async function getEpisodes(alias){
  const html=await text(alias,{headers:{"User-Agent":UA,"Accept":"text/html,application/xhtml+xml"}});
  if(!html)return[];
  const list=extractJsonParse(html,"items");
  if(!Array.isArray(list))return[];
  const out=[];
  let i=1;
  for(const item of list){
    if(!item||!item.url)continue;
    const title=item.title_list&&item.title_list["1"]||null;
    const img=item.snapshot?String(item.snapshot).replace(/\\/g,""):"";
    const filler=String(item.type||"").toLowerCase()==="filler";
    out.push({
      episodeLink:String(item.url).replace(/\\/g,""),
      episodeNumber:i,
      thumbnail:img,
      episodeTitle:title,
      isFiller:filler,
      hasDub:false
    });
    i++
  }
  return out
}

async function getEpisodeStream(episodeUrl){
  const html=await text(episodeUrl,{headers:{"User-Agent":UA,"Accept":"text/html,application/xhtml+xml"}});
  if(!html)return null;

  const data=extractJsonParse(html,null);
  if(!data)return null;

  const src=data.src?String(data.src).replace(/\\/g,""):"";
  if(!src)return null;

  const subtitles=Array.isArray(data.subtitles)?data.subtitles:[];
  const sub=subtitles.find(x=>x&&x.language==="en"&&x.default===true);
  const subtitle=sub&&sub.file?String(sub.file).replace(/\\/g,""):"";
  const format=sub&&sub.format||undefined;

  const serverMatch=/<button[^>]*class=["'][^"']*flex[^"']*gap-2[^"']*relative[^"']*["'][^>]*>([\s\S]*?)<\/button>/i.exec(html);
  const server=serverMatch
    ? serverMatch[1].replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim()
    : "Default";

  return{
    name:"AniZone",
    title:"AniZone • "+server,
    url:src,
    quality:"multi-quality",
    headers:{
      "Referer":BASE+"/",
      "User-Agent":UA
    },
    subtitle:subtitle||undefined,
    subtitleFormat:format,
    backup:false
  }
}

async function getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){
  try{
    if(String(mediaType).toLowerCase()!=="tv")return[];

    const m=await mapping(tmdbId,season,episode);
    if(!m){
      log("No mapping for TMDB="+tmdbId+" S"+season+"E"+episode);
      return[]
    }

    const anime=await findAnime(m);
    if(!anime){
      log("Search failed for "+m.title);
      return[]
    }

    log("Matched "+anime.name+" -> "+anime.alias);

    const eps=await getEpisodes(anime.alias);
    const ep=eps.find(x=>x.episodeNumber===m.malEpisode);

    if(!ep){
      log("Episode "+m.malEpisode+" not found for "+anime.name);
      return[]
    }

    const stream=await getEpisodeStream(ep.episodeLink);
    if(!stream){
      log("Stream extraction failed for episode "+m.malEpisode);
      return[]
    }

    return[stream]
  }catch(e){
    log("Fatal: "+e.message);
    return[]
  }
}

module.exports={getStreams};
