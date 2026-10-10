const API="https://api.animeonsen.xyz/v4",AUTH="https://auth.animeonsen.xyz/oauth/token",CDN="https://cdn.animeonsen.xyz",SITE="https://www.animeonsen.xyz",MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping",UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";
const CLIENT_ID="f296be26-28b5-4358-b5a1-6259575e23b7",CLIENT_SECRET="349038c4157d0480784753841217270c3c5b35f4281eaee029de21cb04084235";
let token=null,tokenExpiration=0,tokenPromise=null;
function log(x){console.log("[AnimeOnsen] "+x)}
class _NuvioTTLCache{constructor(){this.m=new Map()}get(k){const x=this.m.get(k);if(!x)return;if(x.expires<=Date.now()){this.m.delete(k);return}return x.value}set(k,v,ttl){this.m.set(k,{value:v,expires:Date.now()+ttl});return v}delete(k){this.m.delete(k)}}
const _NUVIO_CACHE=globalThis.__NUVIO_PROVIDER_CACHE__||(globalThis.__NUVIO_PROVIDER_CACHE__=new _NuvioTTLCache());
function _cacheGet(k){return _NUVIO_CACHE.get(k)}
function _cacheSet(k,v,ttl){return _NUVIO_CACHE.set(k,v,ttl)}
async function _memo(k,ttl,fn){const hit=_cacheGet(k);if(hit!==undefined)return hit;const p=Promise.resolve().then(fn);_cacheSet(k,p,ttl);try{const v=await p;_cacheSet(k,v,ttl);return v}catch(e){_NUVIO_CACHE.delete(k);throw e}}
async function _timeout(p,ms=4500){let t;try{return await Promise.race([p,new Promise((_,r)=>t=setTimeout(()=>r(new Error("timeout")),ms))])}finally{clearTimeout(t)}}
async function _settle(tasks,ms=4500){const r=await Promise.allSettled(tasks.map(x=>_timeout(Promise.resolve().then(x),ms)));return r.filter(x=>x.status==="fulfilled").map(x=>x.value)}

async function req(url,opt){opt=opt||{};const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);try{return await fetch(url,Object.assign({},opt,{signal:c.signal}))}finally{clearTimeout(t)}}
async function json(url,opt){try{const r=await req(url,opt);if(!r.ok){log("HTTP "+r.status+" "+url);return null}return await r.json()}catch(e){log("Request failed "+url+": "+e.message);return null}}
async function getToken(){const now=Math.floor(Date.now()/1000);if(token&&tokenExpiration>now+3600)return token;if(tokenPromise)return tokenPromise;tokenPromise=(async()=>{const body={client_id:CLIENT_ID,client_secret:CLIENT_SECRET,grant_type:"client_credentials"},r=await req(AUTH,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json","User-Agent":UA},body:JSON.stringify(body)});if(!r.ok)throw new Error("AnimeOnsen token HTTP "+r.status);const d=await r.json();if(!d.access_token)throw new Error("AnimeOnsen token missing");token=d.access_token;tokenExpiration=now+Number(d.expires_in||3600);log("OAuth token refreshed");return token})().finally(()=>{tokenPromise=null});return tokenPromise}
async function api(path,retry=true){const t=await getToken(),d=await json(API+path,{headers:{"Authorization":"Bearer "+t,"Accept":"application/json","User-Agent":UA}},4500);if(!d&&retry){token=null;tokenExpiration=0;try{await getToken();return api(path,false)}catch(e){}}return d}
async function mapping(tmdbId,season,episode){const key="animeonsen:mapping:"+tmdbId+":"+season+":"+episode;const value=await _memo(key,86400000,async()=>{const u=MAPPING_URL+"?tmdbId="+encodeURIComponent(tmdbId)+"&season="+encodeURIComponent(season)+"&episode="+encodeURIComponent(episode)+"&pending=1",d=await json(u,{headers:{"Accept":"application/json","User-Agent":UA}},7000);if(!d||!d.ok||!d.mapping)return null;const m=d.mapping,mal=String(m.mal_id||m.malId||"").trim(),ep=Number(m.mal_episode||m.target_episode||0);if(!mal||!ep)return null;return{malId:mal,malEpisode:ep,title:String(m.anime_title||"").trim(),titles:Array.isArray(m.titles)?m.titles.filter(Boolean).map(String):[]}});if(!value)_NUVIO_CACHE.delete(key);return value}
async function search(query){query=String(query||"").replace(/-/g,"");if(!query)return[];return _memo("animeonsen:search:"+query.toLowerCase(),86400000,async()=>{const d=await api("/search/"+encodeURIComponent(query));if(!d||!Array.isArray(d.result))return[];return d.result.map(x=>({name:x.content_title_en||x.content_title||"",alias:String(x.content_id||""),imageUrl:x.content_id?API+"/image/210x300/"+encodeURIComponent(x.content_id):""})).filter(x=>x.alias)})}
function uniq(a){return[...new Set((a||[]).filter(Boolean).map(String))]}
function normalize(s){return String(s||"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g,"").trim()}
async function findAnime(m){const queries=uniq([m.title,...m.titles]);if(!queries.length)return null;const key="animeonsen:find:"+queries.map(normalize).sort().join("|");return _memo(key,86400000,async()=>{const batches=await _settle(queries.map(q=>()=>search(q)),4500),all=[];for(const rs of batches)for(const x of rs||[])if(!all.some(y=>y.alias===x.alias))all.push(x);for(const q of queries){const exact=all.find(x=>x.name===q);if(exact)return exact}for(const q of queries){const n=normalize(q),exact=all.find(x=>normalize(x.name)===n);if(exact)return exact}return all[0]||null})}
async function getEpisodes(alias){return _memo("animeonsen:episodes:"+alias,3600000,async()=>{const d=await api("/content/"+encodeURIComponent(alias)+"/episodes");if(!d||typeof d!=="object")return[];const out=[];for(const k of Object.keys(d)){const n=Number(k);if(!Number.isInteger(n)||n<1)continue;const x=d[k]||{};out.push({episodeNumber:n,episodeTitle:x.contentTitle_episode_en||null,episodeLink:n+"+"+alias})}return out.sort((a,b)=>a.episodeNumber-b.episodeNumber)})}
async function _getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){try{if(String(mediaType).toLowerCase()!=="tv")return[];const id=String(tmdbId||"").trim(),s=Number(season)||1,e=Number(episode)||1,key="animeonsen:resolved:"+id+":"+s+":"+e;if(_cacheGet(key)!==undefined)return _cacheGet(key);const p=(async()=>{const m=await mapping(id,s,e);if(!m){log("No mapping for TMDB="+id+" S"+s+"E"+e);return[]}const anime=await findAnime(m);if(!anime){log("AnimeOnsen search failed for "+m.title);return[]}log("Matched "+anime.name+" -> "+anime.alias);const eps=await getEpisodes(anime.alias),ep=eps.find(x=>x.episodeNumber===m.malEpisode);if(!ep){log("Episode "+m.malEpisode+" not found for "+anime.name);return[]}const n=ep.episodeNumber,url=CDN+"/video/mp4-dash/"+encodeURIComponent(anime.alias)+"/"+encodeURIComponent(n)+"/manifest.mpd",subtitle=API+"/subtitles/"+encodeURIComponent(anime.alias)+"/en-US/"+encodeURIComponent(n),headers={"Referer":SITE+"/","User-Agent":UA};return[{name:"AnimeOnsen",title:"AnimeOnsen [DASH]",url,quality:"single",headers,subtitle,subtitleFormat:"ASS",backup:false}]})();_cacheSet(key,p,1800000);try{const v=await p;if(v&&v.length)return _cacheSet(key,v,1800000);_NUVIO_CACHE.delete(key);return v}catch(err){_NUVIO_CACHE.delete(key);throw err}}catch(e){log("Fatal: "+e.message);return[]}}


// Shared subtitle integration. Only Lee, AniZone, Reanime and VidNest may publish.
const _SHARED_SUBTITLE_ENDPOINT="https://anikoto-nuvio.netlify.app/.netlify/functions/shared-subtitles";
const _SHARED_SUBTITLE_PUBLISHERS=new Set(["lee","anizone","reanime","vidnest"]);
function _sharedLangName(value){
  const s=String(value||"").trim(); if(!s)return "Unknown";
  const k=s.toLowerCase().replace(/[_-]/g,"");
  const known={en:"English",eng:"English",english:"English",ja:"Japanese",jpn:"Japanese",japanese:"Japanese",es:"Spanish",spa:"Spanish",spanish:"Spanish",fr:"French",fre:"French",fra:"French",french:"French",de:"German",ger:"German",deu:"German",german:"German",pt:"Portuguese",por:"Portuguese",it:"Italian",ita:"Italian",ru:"Russian",rus:"Russian",zh:"Chinese",chi:"Chinese",zho:"Chinese",ko:"Korean",kor:"Korean",ar:"Arabic",ara:"Arabic",hi:"Hindi",hin:"Hindi"};
  return known[k]||s;
}
function _sharedSubtitleFormat(track){
  const f=String(track&& (track.format||track.subtitleFormat||track.type)||"").toLowerCase().replace(/^\./,"");
  if(["vtt","srt","ass","ssa","ttml","dfxp"].includes(f))return f;
  const u=String(track&&(track.url||track.file||track.src)||"").toLowerCase().split(/[?#]/)[0];
  const m=u.match(/\.(vtt|srt|ass|ssa|ttml|dfxp)$/); return m?m[1]:"vtt";
}
function _sharedNormalizeTracks(streams,providerName){
  const out=[];
  for(const stream of (Array.isArray(streams)?streams:[])){
    const candidates=Array.isArray(stream&&stream.subtitles)?stream.subtitles.slice():[];
    if(stream&&typeof stream.subtitle==="string"&&stream.subtitle.trim())candidates.push({url:stream.subtitle,format:stream.subtitleFormat||"",language:"en",name:"English"});
    for(const t of candidates){
      if(!t||typeof t!=="object")continue;
      const url=String(t.url||t.file||t.src||"").trim();
      if(!/^https?:\/\//i.test(url))continue;
      const rawLang=String(t.language||t.lang||t.srclang||t.label||"en").trim();
      const language=_sharedLangName(rawLang);
      const rawName=String(t.name||t.label||t.title||"").trim();
      const display=rawName&&rawName.toLowerCase()!==rawLang.toLowerCase()?_sharedLangName(rawName):language;
      out.push({url,language,name:display,format:_sharedSubtitleFormat({...t,url}),sourceProvider:providerName});
    }
  }
  const seen=new Set();
  return out.filter(t=>{const k=t.url+"\n"+t.language.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;});
}
function _sharedEpisodeParams(tmdbId,mediaType,season,episode){
  const type=String(mediaType||"tv").toLowerCase()==="movie"?"movie":"tv";
  const id=String(tmdbId||"").trim();
  const s=Number(season),e=Number(episode);
  if(!/^\d+$/.test(id)||Number(id)<=0)return null;
  if(type==="tv"&&(!Number.isInteger(s)||s<0||!Number.isInteger(e)||e<1))return null;
  return {tmdb_id:id,media_type:type,season:type==="tv"?s:0,episode:type==="tv"?e:0};
}
async function _sharedSubtitleRequest(url,options,timeoutMs=1400){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{const r=await fetch(url,{...options,signal:controller.signal});if(!r.ok){console.log(`[Shared subtitles] HTTP ${r.status} ${options&&options.method||"GET"}`);return null;}return await r.json();}
  catch(e){console.log(`[Shared subtitles] ${String(e&&e.message||e)}`);return null;}finally{clearTimeout(timer);}
}
async function _sharedReadSubtitles(identity){
  if(!identity)return[];
  const q=new URLSearchParams(identity).toString();
  const d=await _sharedSubtitleRequest(_SHARED_SUBTITLE_ENDPOINT+"?"+q,{headers:{Accept:"application/json"}},1200);
  if(!d||d.ok!==true||!Array.isArray(d.subtitles))return[];
  return d.subtitles.filter(t=>t&&/^https?:\/\//i.test(String(t.url||""))).map(t=>({
    url:String(t.url),language:String(t.language||"Unknown"),format:String(t.format||"vtt"),
    name:_sharedLangName(t.name||t.language||"Unknown"),
    sourceProvider:String(t.sourceProvider||"Unknown source")
  }));
}
async function _sharedPublishSubtitles(identity,tracks,providerName){
  if(!identity||!_SHARED_SUBTITLE_PUBLISHERS.has(String(providerName||"").toLowerCase())||!tracks.length)return;
  // A single bounded POST per provider/episode avoids duplicate per-track requests.
  await _sharedSubtitleRequest(_SHARED_SUBTITLE_ENDPOINT,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({...identity,provider:providerName,subtitles:tracks.map(t=>({url:t.url,language:t.language,name:t.name,format:t.format}))})},1600);
}
async function _sharedSubtitleWrap(tmdbId,mediaType,season,episode,settings,providerName,publisher,run){
  let streams=[];
  try{streams=await run(tmdbId,mediaType,season,episode,settings);}catch(e){console.log(`[${providerName}] scraper failed: ${String(e&&e.message||e)}`);return[];}
  if(!Array.isArray(streams)||!streams.length)return[];
  const identity=_sharedEpisodeParams(tmdbId,mediaType,season,episode);
  const nativeTracks=_sharedNormalizeTracks(streams,providerName);
  if(publisher&&nativeTracks.length)await _sharedPublishSubtitles(identity,nativeTracks,providerName);
  const shared=await _sharedReadSubtitles(identity);
  // Native tracks first; keep source attribution visible for both native and shared tracks.
  const combined=[];const seen=new Set();
  for(const t of [...nativeTracks,...shared]){
    const k=t.url+"\n"+String(t.language||"").toLowerCase();if(seen.has(k))continue;seen.add(k);
    const origin=String(t.sourceProvider||providerName);
    const display=_sharedLangName(t.name||t.language||"Unknown");
    combined.push({url:t.url,language:t.language,format:t.format||"vtt",sourceProvider:origin,name:`${display} · ${origin}${origin.toLowerCase()===String(providerName).toLowerCase()?"":" (shared)"}`});
  }
  return streams.map(stream=>{
    const native=Array.isArray(stream.subtitles)?stream.subtitles:[];
    const merged=[];const localSeen=new Set();
    for(const t of [...native,...combined]){
      if(!t||!t.url)continue;
      const url=String(t.url),lang=String(t.language||t.lang||"Unknown"),k=url+"\n"+lang.toLowerCase();
      if(localSeen.has(k))continue;localSeen.add(k);
      const src=String(t.sourceProvider||"");
      let name=String(t.name||t.label||_sharedLangName(lang));
      if(!name.includes(" · "))name+=` · ${src||providerName}`;
      merged.push({url,language:lang,name,label:name,format:t.format||_sharedSubtitleFormat(t)});
    }
    const result={...stream,subtitles:merged};
    // Preserve existing singular subtitle fields; the normalized array is the shared menu source.
    return result;
  });
}

async function getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){return _sharedSubtitleWrap(tmdbId,mediaType,season,episode,settings,"AnimeOnsen",false,_getStreams);}
module.exports={getStreams};
