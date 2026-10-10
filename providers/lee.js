"use strict";
// Lee / ani.pm API provider port; session tokens are resolved per request.

const BASE="https://ani.pm", EMBED="https://embed.settlar.io";
async function leeJSON(url){return _json(url,{headers:{"Referer":BASE+"/","Accept":"application/json"}},10000)}
async function _getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){try{if(String(mediaType).toLowerCase()!=="tv")return[];const m=await _mapping(tmdbId,season,episode);if(!m)return[];const al=await _anilistId(m.malId);if(!al)return[];const lang=_lang(settings),epNo=m.episode;const series=await leeJSON(`${BASE}/api/anime/ani/${encodeURIComponent(al.id)}?phase=core&routes=e4`);if(!series||!series.settlarId||!Array.isArray(series.episodes))return[];const ep=series.episodes.find(x=>Number(x.number)===epNo);if(!ep||!(lang==="dub"?ep.dub:ep.sub))return[];const sourceNumber=String(ep.sourceNumber==null?epNo:ep.sourceNumber);const boot=await leeJSON(`${BASE}/api/anime/playback-bootstrap/settlar/${series.settlarId}?ep=${encodeURIComponent(sourceNumber)}&lang=${lang}&backup=1`);if(!boot||!(lang==="dub"?boot.availability&&boot.availability.dub:boot.availability&&boot.availability.sub)||!boot.settlarSelection)return[];const sess=await leeJSON(`${BASE}/api/anime/settlar/session?selection=${encodeURIComponent(boot.settlarSelection)}&provider=anipm&ep=${epNo}&channel=${lang}&telemetry=0`);const token=String(sess&&sess.embedUrl||"").split("?t=")[1];if(!token)return[];const es=await _json(`${EMBED}/api/embed/session?t=${encodeURIComponent(token)}`,{headers:{"Referer":BASE+"/","Accept":"application/json"}},10000);if(!es||!es.source)return[];const subs=(es.subtitles||[]).map(x=>({url:x.url||x.file,language:x.lang||x.srclang||x.label||x.name||"en",format:/\.vtt/i.test(x.url||x.file||"")?"vtt":"srt"})).filter(x=>x.url);return [{name:"Lee",title:"Lee · "+lang.toUpperCase(),url:es.source,quality:"auto",type:(String(es.kind).toLowerCase()==="mp4"||/\.mp4(?:[?#]|$)/i.test(es.source))?"mp4":"m3u8",headers:{Referer:BASE+"/","User-Agent":UA},subtitles:subs,backup:false}]}catch(e){console.log("[Lee] "+String(e&&e.message||e));return[]}}


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

async function getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){return _sharedSubtitleWrap(tmdbId,mediaType,season,episode,settings,"Lee",true,_getStreams);}
module.exports={getStreams};
