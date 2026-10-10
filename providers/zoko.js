"use strict";
// ZokoAnime direct stream resolver. Uses its in-page XOR payload format.

const MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping";
const UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";
async function _req(url,opt={},ms=9000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{...opt,headers:{"User-Agent":UA,"Accept":"*/*",...(opt.headers||{})},signal:c.signal})}finally{clearTimeout(t)}}
async function _json(url,opt={},ms=9000){try{const r=await _req(url,opt,ms);if(!r.ok)return null;return await r.json()}catch(e){return null}}
async function _text(url,opt={},ms=9000){try{const r=await _req(url,opt,ms);if(!r.ok)return "";return await r.text()}catch(e){return ""}}
async function _mapping(tmdbId,season,episode){const u=MAPPING_URL+"?tmdb_id="+encodeURIComponent(tmdbId)+"&tmdbId="+encodeURIComponent(tmdbId)+"&season="+encodeURIComponent(season)+"&episode="+encodeURIComponent(episode)+"&pending=1";const d=await _json(u,{},5500);if(!d||!d.ok||!d.mapping)return null;const m=d.mapping,malId=String(m.mal_id||m.malId||"").trim(),malEpisode=Number(m.mal_episode||m.target_episode||0);if(!malId||!Number.isInteger(malEpisode)||malEpisode<1)return null;return {malId,episode:malEpisode,title:String(m.anime_title||m.title||"").trim(),titles:Array.isArray(m.titles)?m.titles.filter(Boolean).map(String):[]}}
async function _anilistId(malId){const q='query($idMal:Int){Media(idMal:$idMal,type:ANIME){id title{english romaji native}}}';const d=await _json("https://graphql.anilist.co",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({query:q,variables:{idMal:Number(malId)}})},7000);const m=d&&d.data&&d.data.Media;return m&&m.id?{id:String(m.id),titles:[m.title.english,m.title.romaji,m.title.native].filter(Boolean)}:null}
function _lang(settings){const x=String(settings&& (settings.language||settings.audio||settings.lang)||"sub").toLowerCase();return x.includes("dub")?"dub":"sub"}
function _unique(a){return [...new Set((a||[]).filter(Boolean))]}
function _decodeAnimeX(u){if(!String(u).includes('/uwu/'))return {url:u,referer:""};try{let tok=String(u).split('/uwu/').pop();tok=tok.replace(/-/g,'+').replace(/_/g,'/');while(tok.length%4)tok+='=';const raw=atob(tok),key='10b06cdc1ca48c9fb0b94af97cc040cf';let s='';for(let i=0;i<raw.length;i++)s+=String.fromCharCode(raw.charCodeAt(i)^key.charCodeAt(i%key.length));const p=s.split('\0');return {url:p[0]||u,referer:p[1]||''}}catch(e){return {url:u,referer:''}}}

const BASE="https://zokoanime.video",KEY="otaku-embed-v1";
function decodeZoko(blob){try{const raw=atob(blob);let s="";for(let i=0;i<raw.length;i++)s+=String.fromCharCode(raw.charCodeAt(i)^KEY.charCodeAt(i%KEY.length));return JSON.parse(s)}catch(e){return null}}
async function resolve(id,episode,lang,key){const page=await _text(`${BASE}/stream/${key}/${encodeURIComponent(id)}/${episode}/${lang}`,{headers:{"Referer":BASE+"/","Accept":"text/html,application/xhtml+xml,*/*"}},9000);const hit=page.match(/window\.__P\s*=\s*["']([^"']+)["']/);return hit?decodeZoko(hit[1]):null}
async function _getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){try{if(String(mediaType).toLowerCase()!=="tv")return[];const m=await _mapping(tmdbId,season,episode);if(!m)return[];const lang=_lang(settings);let p=await resolve(m.malId,m.episode,lang,"mal");if(!p){const al=await _anilistId(m.malId);if(al)p=await resolve(al.id,m.episode,lang,"ani")}if(!p||!p.src)return[];const streamHeaders={Referer:BASE+"/","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"};const subs=(p.subtitles||[]).filter(x=>x&&x.src).map(x=>({url:String(x.src),language:String(x.lang||"en"),name:String(x.label||x.lang||"English")}));return [{name:"Zoko",title:"Zoko · "+lang.toUpperCase(),url:p.src,quality:"auto",type:"m3u8",headers:streamHeaders,subtitles:subs,backup:false}]}catch(e){console.log("[Zoko] "+String(e&&e.message||e));return[]}}


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

async function getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){return _sharedSubtitleWrap(tmdbId,mediaType,season,episode,settings,"Zoko",false,_getStreams);}
module.exports={getStreams};
