const LAZY_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping",NORMAL_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-mapping",POPULATE_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-populate-background",UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36",TTL=86400000,MOVIE_TTL=300000,RESOLVE_TIMEOUT=5000,BG_TTL=30000;
const STATE=globalThis.__ANIKOTO_SHARED_MAPPING__||(globalThis.__ANIKOTO_SHARED_MAPPING__={values:new Map(),inflight:new Map(),background:new Map()});
function log(x){console.log("[SHARED MAPPING] "+x)}
function valid(m){if(!m)return null;const mal=String(m.mal_id||m.malId||"").trim(),ep=Number(m.mal_episode||m.target_episode||m.malEpisode||0);return mal&&Number.isInteger(ep)&&ep>0?{...m,mal_id:mal,mal_episode:ep}:null}
async function req(url,timeout=5000,opt={}){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{...opt,headers:{Accept:"application/json","User-Agent":UA,...(opt.headers||{})},signal:c.signal});if(!r.ok)return null;return await r.json()}catch(e){return null}finally{clearTimeout(t)}}
function cacheGet(k){const x=STATE.values.get(k);if(!x)return undefined;if(x.expires<=Date.now()){STATE.values.delete(k);return undefined}return x.value}
function cacheSet(k,v,ttl){STATE.values.set(k,{value:v,expires:Date.now()+ttl});return v}
function background(m,id,s,e,force=false){
if(!m||!m.mal_id||(!force&&String(m.source||"")==="lazy-db"))return;
const k=String(id)+":"+Number(s)+":"+Number(e),old=STATE.background.get(k);
if(old&&old>Date.now())return;
STATE.background.set(k,Date.now()+BG_TTL);
try{void fetch(POPULATE_URL,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json","User-Agent":UA},body:JSON.stringify({tmdb_id:String(m.tmdb_id||id),imdb_id:m.imdb_id||"",mal_id:m.mal_id,title:m.anime_title||m.title||"",season:Number(s),episode:Number(e),mal_episode:Number(m.mal_episode)})}).catch(()=>{})}catch(e){}
}
async function resolve(id,type,s,e){
type=String(type||"tv").toLowerCase();
if(type==="movie"){
const d=await req(LAZY_URL+"?tmdbId="+encodeURIComponent(id)+"&mediaType=movie",RESOLVE_TIMEOUT),m=valid(d&&d.mapping);
if(m){log("MOVIE LAZY HIT TMDB="+id);return m}
log("MOVIE LAZY MISS TMDB="+id);return null
}
const lazy=await req(LAZY_URL+"?tmdbId="+encodeURIComponent(id)+"&season="+encodeURIComponent(s)+"&episode="+encodeURIComponent(e),3000),lm=valid(lazy&&lazy.mapping);
if(lm){
log("LAZY DB HIT TMDB="+id+" S"+s+"E"+e);
if(lazy&&lazy.population&&lazy.population.status!=="complete")background(lm,id,s,e,true);
return lm
}
const resolved=await req(LAZY_URL+"?resolve=1&tmdbId="+encodeURIComponent(id)+"&season="+encodeURIComponent(s)+"&episode="+encodeURIComponent(e),RESOLVE_TIMEOUT),rm=valid(resolved&&resolved.mapping);
if(rm){log("LAZY RESOLVED TMDB="+id+" S"+s+"E"+e);background(rm,id,s,e);return rm}
const normal=await req(NORMAL_URL+"?tmdbId="+encodeURIComponent(id)+"&season="+encodeURIComponent(s)+"&episode="+encodeURIComponent(e),7000),nm=valid(normal&&normal.mapping);
if(nm){log("NORMAL HIT TMDB="+id+" S"+s+"E"+e);background(nm,id,s,e);return nm}
log("MAPPING MISS TMDB="+id+" S"+s+"E"+e);return null
}
async function getMapping(tmdbId,mediaType="tv",season=1,episode=1){
const id=String(tmdbId||"").trim(),type=String(mediaType||"tv").toLowerCase(),s=type==="movie"?1:Number(season)||1,e=type==="movie"?1:Number(episode)||1;
if(!id)return null;
const k=type+":"+id+":"+s+":"+e,cached=cacheGet(k);
if(cached!==undefined)return cached;
if(STATE.inflight.has(k))return STATE.inflight.get(k);
const p=resolve(id,type,s,e).then(v=>cacheSet(k,v,type==="movie"?MOVIE_TTL:TTL)).catch(err=>{log("ERROR "+id+": "+err.message);cacheSet(k,null,30000);return null}).finally(()=>STATE.inflight.delete(k));
STATE.inflight.set(k,p);return p
}
function clearMappingCache(){STATE.values.clear();STATE.inflight.clear();STATE.background.clear()}
module.exports={getMapping,clearMappingCache};
