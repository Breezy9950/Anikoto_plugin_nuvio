/* Reanime provider: mapper-first (MAL->AniList via idMal) with reanime native fallback.
   Does NOT populate the mapper - read-only lookups via pending=1. */
const MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping";
const REANIME_DOMAINS=["https://reanime.to","https://reanime.cz","https://reanime.wtf"];
const FLIXCLOUD_BASE="https://flixcloud.cc";
const TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706";
const ANILIST_URL="https://graphql.anilist.co";
const UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";
const HEADERS={"User-Agent":UA,"Accept":"application/json, text/plain, */*","Accept-Language":"en-US,en;q=0.9"};
const FLIX_HEADERS={"User-Agent":UA,"Accept":"*/*","Origin":FLIXCLOUD_BASE,"Referer":FLIXCLOUD_BASE+"/"};

function log(x){console.log("[Reanime] "+x)}

class NuvioTTLCache{
  constructor(){this.m=new Map()}
  get(k){const x=this.m.get(k);if(!x)return;if(x.e<=Date.now()){this.m.delete(k);return}return x.v}
  set(k,v,ttl){this.m.set(k,{v:v,e:Date.now()+ttl});return v}
  delete(k){this.m.delete(k)}
}
const CACHE=globalThis.__NUVIO_PROVIDER_CACHE__||(globalThis.__NUVIO_PROVIDER_CACHE__=new NuvioTTLCache());

async function memo(key,ttl,fn){
  const hit=CACHE.get(key);
  if(hit!==undefined)return hit;
  const p=Promise.resolve().then(fn);
  CACHE.set(key,p,ttl);
  try{const v=await p;CACHE.set(key,v,ttl);return v}
  catch(e){CACHE.delete(key);throw e}
}

async function timeout(p,ms){
  let t;
  try{
    return await Promise.race([p,new Promise(function(_,r){t=setTimeout(function(){r(new Error("timeout"))},ms)})]);
  }finally{clearTimeout(t)}
}

function raceWithTimeout(promise,ms){
  return Promise.race([promise,new Promise(function(_,r){setTimeout(function(){r(new Error("timeout"))},ms)})]);
}

async function req(url,opt,ms){
  opt=opt||{};
  const c=new AbortController();
  const t=setTimeout(function(){c.abort()},ms||10000);
  try{return await fetch(url,Object.assign({},opt,{signal:c.signal}))}
  finally{clearTimeout(t)}
}

async function json(url,opt,ms){
  try{
    const r=await req(url,opt,ms);
    if(!r||!r.ok){log("HTTP "+(r&&r.status)+" "+url.split("?")[0]);return null}
    return await r.json();
  }catch(e){log("JSON fail "+url.split("?")[0]+": "+e.message);return null}
}

async function text(url,opt,ms){
  try{
    const r=await req(url,opt,ms);
    if(!r||!r.ok){log("HTTP "+(r&&r.status)+" "+url.split("?")[0]);return null}
    return await r.text();
  }catch(e){log("TEXT fail "+url.split("?")[0]+": "+e.message);return null}
}

async function resolveTmdbId(id,type){
  id=String(id||"").trim();
  if(/^\d+$/.test(id))return id;
  if(!/^tt\d+$/i.test(id))return id;
  const cacheKey="reanime:tmdb:find:"+String(type||"tv").toLowerCase()+":"+id;
  const hit=CACHE.get(cacheKey);
  if(hit!==undefined)return hit;
  const t=String(type||"tv").toLowerCase()==="movie"?"movie_results":"tv_results";
  const u="https://api.themoviedb.org/3/find/"+encodeURIComponent(id)+"?api_key="+TMDB_API_KEY+"&external_source=imdb_id";
  let result=id;
  try{
    const d=await raceWithTimeout(json(u,{headers:{"Accept":"application/json","User-Agent":UA}},3500),4000);
    const a=d&&Array.isArray(d[t])?d[t]:[];
    if(a[0]&&a[0].id)result=String(a[0].id);
  }catch(e){}
  CACHE.set(cacheKey,result,604800000);
  return result;
}

let activeBase=REANIME_DOMAINS[0];
async function reanimeReq(path,opt,ms){
  const ordered=activeBase?[activeBase].concat(REANIME_DOMAINS.filter(function(x){return x!==activeBase})):REANIME_DOMAINS.slice();
  for(let i=0;i<ordered.length;i++){
    const base=ordered[i];
    try{
      const headers=Object.assign({},(opt&&opt.headers)||{});
      if(!headers["Referer"]&&!headers.referer)headers["Referer"]=base+"/";
      const r=await req(base+path,Object.assign({},opt,{headers:headers}),ms);
      if(r&&r.ok){activeBase=base;return r}
    }catch(e){}
  }
  return null;
}

async function mapperLookup(tmdbId,season,episode){
  const u=MAPPING_URL+"?tmdb_id="+encodeURIComponent(tmdbId)+"&tmdbId="+encodeURIComponent(tmdbId)+"&season="+season+"&episode="+episode+"&pending=1";
  const d=await json(u,{headers:{"Accept":"application/json","User-Agent":UA}},5000);
  if(!d||!d.ok||!d.mapping)return null;
  const m=d.mapping;
  const malId=String(m.mal_id||m.malId||"").trim();
  const malEpisode=Number(m.mal_episode||m.target_episode||0);
  if(!malId||!malEpisode)return null;
  return {malId:malId,malEpisode:malEpisode,title:String(m.anime_title||m.title||"").trim()};
}

async function malToAnilist(malId){
  return memo("reanime:mal2al:"+malId,604800000,async function(){
    const q="query($idMal:Int){Media(idMal:$idMal,type:ANIME){id title{english romaji native}}}";
    const h=Object.assign({},HEADERS,{"Content-Type":"application/json"});
    const d=await json(ANILIST_URL,{method:"POST",headers:h,body:JSON.stringify({query:q,variables:{idMal:parseInt(malId,10)}})},3500);
    if(!d||!d.data||!d.data.Media||!d.data.Media.id)return null;
    const t=d.data.Media.title||{};
    return {id:d.data.Media.id,title:t.english||t.romaji||t.native||""};
  });
}

async function flixServers(anilistId,episode){
  return memo("reanime:flix:"+anilistId+":"+episode,1800000,async function(){
    const path="/api/flix/"+encodeURIComponent(anilistId)+"/"+encodeURIComponent(episode);
    const r=await reanimeReq(path,{headers:HEADERS},3500);
    if(!r)return null;
    let d=null;
    try{d=await r.json()}catch(e){return null}
    if(!d||!d.success||!Array.isArray(d.servers))return null;
    return d.servers;
  });
}

async function extractFlix(embedUrl){
  const m=String(embedUrl||"").match(/\/e\/([a-z0-9]+)/i);
  if(!m)return null;
  const aid=m[1];
  const t=await text(FLIXCLOUD_BASE+"/d/"+aid+"/__data.json",{headers:FLIX_HEADERS},5000);
  if(!t)return null;
  const fileMatch=t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const tokenMatch=t.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
  if(!fileMatch||!tokenMatch)return null;
  const fileId=fileMatch[0];
  const token=tokenMatch[0];
  const baseMatch=t.match(/https:\/\/[a-z0-9-]+\.flixcloud\.cc/i);
  const base=baseMatch?baseMatch[0]:FLIXCLOUD_BASE;
  const qMatch=t.match(/(\d{3,4}p)/);
  const q=qMatch?qMatch[0]:"1080p";
  const sizeMatch=t.match(/"(\d+(?:\.\d+)?\s*[KMG]B)"/i);
  const size=sizeMatch?sizeMatch[1]:"Unknown";
  return {url:base+"/download/"+fileId+"?token="+token,quality:q,size:size,headers:FLIX_HEADERS};
}

async function tmdbInfo(tmdbId,mediaType){
  return memo("reanime:tmdb:"+mediaType+":"+tmdbId,86400000,async function(){
    const type=mediaType==="movie"?"movie":"tv";
    const url="https://api.themoviedb.org/3/"+type+"/"+encodeURIComponent(tmdbId)+"?api_key="+TMDB_API_KEY+"&language=en-US";
    const d=await json(url,{headers:{"Accept":"application/json","User-Agent":UA}},3500);
    if(!d)return null;
    return {title:d.name||d.title||d.original_name||d.original_title||"",originalTitle:d.original_name||d.original_title||""};
  });
}

function extractAnilistId(item){
  if(!item)return null;
  const direct=item.anilist_id||item.anilistId;
  if(direct)return String(direct);
  const urls=[
    item.cover_image&&item.cover_image.extra_large,
    item.cover_image&&item.cover_image.large,
    item.cover_image&&item.cover_image.medium,
    item.banner_image
  ].filter(Boolean);
  for(let i=0;i<urls.length;i++){
    const m=String(urls[i]).match(/\/b?x?(\d+)-|\/(\d+)[-.]/);
    if(m)return m[1]||m[2];
  }
  return null;
}

async function searchReanime(query){
  return memo("reanime:search:"+query.toLowerCase(),86400000,async function(){
    const paths=["/api/v1/search?q="+encodeURIComponent(query)+"&limit=36","/api/search?q="+encodeURIComponent(query)];
    for(let i=0;i<paths.length;i++){
      const path=paths[i];
      const r=await reanimeReq(path,{headers:HEADERS},3500);
      if(!r)continue;
      const t=await r.text().catch(function(){return""});
      if(!t)continue;
      const trim=t.trim();
      if(trim[0]!=="{"&&trim[0]!=="[")continue;
      let d=null;
      try{d=JSON.parse(t)}catch(e){continue}
      const list=d.results||d.data||d.anime||(Array.isArray(d)?d:null);
      if(!Array.isArray(list))continue;
      const out=[];
      for(let j=0;j<list.length;j++){
        const item=list[j];
        if(!item)continue;
        const rawSlug=item.anime_id||item.slug||item.id||item.url;
        if(!rawSlug)continue;
        const alId=extractAnilistId(item);
        if(!alId)continue;
        const titles=[];
        if(item.title&&typeof item.title==="object"){
          if(item.title.english)titles.push(item.title.english);
          if(item.title.romaji)titles.push(item.title.romaji);
          if(item.title.native)titles.push(item.title.native);
        }else if(typeof item.title==="string")titles.push(item.title);
        if(item.name)titles.push(item.name);
        out.push({slug:String(rawSlug),titles:titles,title:titles[0]||String(rawSlug),anilistId:String(alId)});
      }
      if(out.length)return out;
    }
    return [];
  });
}

function normTitle(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}

function scoreTitle(candidate,info){
  const targets=[info.title,info.originalTitle].filter(Boolean).map(normTitle).filter(Boolean);
  let best=0;
  const titles=candidate.titles||[];
  for(let i=0;i<titles.length;i++){
    const n=normTitle(titles[i]);
    if(!n)continue;
    for(let j=0;j<targets.length;j++){
      const target=targets[j];
      if(n===target)best=Math.max(best,100);
      else if(n.indexOf(target)>=0||target.indexOf(n)>=0)best=Math.max(best,50);
    }
  }
  return best;
}

async function resolveNative(tmdbId,mediaType,season,episode,prefetchedInfo){
  const info=prefetchedInfo||await tmdbInfo(tmdbId,mediaType);
  if(!info||!info.title)return null;
  const queries=[info.title];
  if(info.originalTitle&&info.originalTitle!==info.title)queries.push(info.originalTitle);
  const results=await Promise.all(queries.map(function(q){return searchReanime(q).catch(function(){return[]})}));
  const all=[];
  for(let i=0;i<results.length;i++){
    const r=results[i];
    for(let j=0;j<r.length;j++){
      const x=r[j];
      if(!all.some(function(y){return y.anilistId===x.anilistId}))all.push(x);
    }
  }
  if(!all.length)return null;
  const scored=all.map(function(x){return {x:x,score:scoreTitle(x,info)}});
  scored.sort(function(a,b){return b.score-a.score});
  const best=scored[0];
  if(!best||best.score<=0)return null;
  return {alId:best.x.anilistId,title:best.x.title||info.title,episode:mediaType==="movie"?1:episode,malId:null};
}

async function buildStreams(resolved,mediaType){
  const servers=await flixServers(resolved.alId,resolved.episode).catch(function(){return null});
  if(!Array.isArray(servers)||!servers.length)return [];
  const subList=servers.filter(function(s){return s&&s.dataType&&String(s.dataType).toLowerCase()==="sub"});
  const dubList=servers.filter(function(s){return s&&s.dataType&&String(s.dataType).toLowerCase()==="dub"});
  const tasks=[];
  const displayTitle=resolved.title||"Anime";
  function queue(list,lang){
    if(!Array.isArray(list))return;
    const langUpper=lang.toUpperCase();
    for(let i=0;i<list.length;i++){
      const sv=list[i];
      if(!sv||!sv.dataLink)continue;
      const serverName=sv.serverName||("HD-"+(i+1));
      const title=mediaType==="movie"?displayTitle+" ("+langUpper+")":displayTitle+" - Episode "+resolved.episode+" ("+langUpper+")";
      tasks.push((async function(){
        const dl=await extractFlix(sv.dataLink).catch(function(){return null});
        if(!dl||!dl.url)return null;
        return {
          name:"Reanime ["+langUpper+"] "+serverName+" ("+(dl.quality||"1080p")+")",
          title:title,
          url:dl.url,
          quality:dl.quality||"1080p",
          size:dl.size||"Unknown",
          headers:dl.headers,
          provider:"reanime",
          type:"mkv"
        };
      })());
    }
  }
  queue(subList,"sub");
  queue(dubList,"dub");
  if(!tasks.length)return [];
  const results=await Promise.all(tasks);
  const seen={};
  const streams=[];
  for(let i=0;i<results.length;i++){
    const r=results[i];
    if(r&&r.url&&!seen[r.url]){seen[r.url]=1;streams.push(r)}
  }
  const qr={"2160p":2160,"4k":2160,"1080p":1080,"720p":720,"480p":480,"360p":360};
  streams.sort(function(a,b){return (qr[String(b.quality||"").toLowerCase()]||0)-(qr[String(a.quality||"").toLowerCase()]||0)});
  return streams;
}

async function getStreams(tmdbId,mediaType,season,episode,settings){
  try{
    mediaType=String(mediaType||"tv").toLowerCase();
    const id=await resolveTmdbId(String(tmdbId||"").trim(),mediaType);
    if(!id)return [];
    const s=Number(season)||1;
    const e=Number(episode)||1;
    const mapSeason=mediaType==="movie"?1:s;
    const mapEpisode=mediaType==="movie"?1:e;
    const key="reanime:streams:"+id+":"+mediaType+":"+s+":"+e;
    const hit=CACHE.get(key);
    if(hit!==undefined)return hit;
    const p=(async function(){
      const tmdbPromise=tmdbInfo(id,mediaType).catch(function(){return null});
      let resolved=null;
      let source="mapper";
      try{
        const m=await timeout(mapperLookup(id,mapSeason,mapEpisode),5000);
        if(m){
          const al=await timeout(malToAnilist(m.malId),3500);
          if(al){
            resolved={alId:al.id,title:m.title||al.title,episode:m.malEpisode,malId:m.malId};
            log("Mapper hit MAL="+m.malId+" AL="+al.id+" E"+m.malEpisode);
          }else log("Mapper hit but MAL->AL failed MAL="+m.malId);
        }else log("Mapper miss TMDB="+id+" S"+s+"E"+e);
      }catch(err){log("Mapper error: "+err.message)}
      let streams=[];
      if(resolved){
        try{streams=await timeout(buildStreams(resolved,mediaType),10000)}
        catch(err){log("Mapper streams error: "+err.message)}
      }
      if(!streams.length){
        log("Falling back to native");
        source="native";
        try{
          const info=await timeout(tmdbPromise,3500);
          const native=await timeout(resolveNative(id,mediaType,s,e,info),7000);
          if(native){resolved=native;streams=await timeout(buildStreams(native,mediaType),10000)}
        }catch(err){log("Native error: "+err.message)}
      }
      log("Done streams="+streams.length+" src="+source);
      return streams;
    })();
    CACHE.set(key,p,1800000);
    try{const out=await p;CACHE.set(key,out,1800000);return out}
    catch(err){CACHE.delete(key);return[]}
  }catch(err){
    log("Fatal: "+(err&&err.message||err));
    return [];
  }
}

module.exports={getStreams:getStreams};
