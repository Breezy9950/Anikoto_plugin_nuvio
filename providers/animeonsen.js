const API="https://api.animeonsen.xyz/v4",AUTH="https://auth.animeonsen.xyz/oauth/token",CDN="https://cdn.animeonsen.xyz",SITE="https://www.animeonsen.xyz",MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-mapping",UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";
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

async function req(url,opt,timeoutMs=5000){opt=opt||{};const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);try{return await fetch(url,Object.assign({},opt,{signal:c.signal}))}finally{clearTimeout(t)}}
async function json(url,opt){try{const r=await req(url,opt);if(!r.ok){log("HTTP "+r.status+" "+url);return null}return await r.json()}catch(e){log("Request failed "+url+": "+e.message);return null}}
async function getToken(){const now=Math.floor(Date.now()/1000);if(token&&tokenExpiration>now+3600)return token;if(tokenPromise)return tokenPromise;tokenPromise=(async()=>{const body={client_id:CLIENT_ID,client_secret:CLIENT_SECRET,grant_type:"client_credentials"},r=await req(AUTH,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json","User-Agent":UA},body:JSON.stringify(body)},2500);if(!r.ok)throw new Error("AnimeOnsen token HTTP "+r.status);const d=await r.json();if(!d.access_token)throw new Error("AnimeOnsen token missing");token=d.access_token;tokenExpiration=now+Number(d.expires_in||3600);log("OAuth token refreshed");return token})().finally(()=>{tokenPromise=null});return tokenPromise}
async function api(path,retry=true){const t=await getToken(),d=await json(API+path,{headers:{"Authorization":"Bearer "+t,"Accept":"application/json","User-Agent":UA}},3500);if(!d&&retry){token=null;tokenExpiration=0;try{await getToken();return api(path,false)}catch(e){}}return d}
async function mapping(tmdbId,season,episode){return _memo("animeonsen:mapping:"+tmdbId+":"+season+":"+episode,86400000,async()=>{const u=MAPPING_URL+"?tmdbId="+encodeURIComponent(tmdbId)+"&season="+encodeURIComponent(season)+"&episode="+encodeURIComponent(episode),d=await json(u,{headers:{"Accept":"application/json","User-Agent":UA}},3000);if(!d||!d.ok||!d.mapping)return null;const m=d.mapping,mal=String(m.mal_id||m.malId||"").trim(),ep=Number(m.mal_episode||m.target_episode||0);if(!mal||!ep)return null;return{malId:mal,malEpisode:ep,title:String(m.anime_title||"").trim(),titles:Array.isArray(m.titles)?m.titles.filter(Boolean).map(String):[]}})}

const LAZY_MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping",TMDB_API="https://api.themoviedb.org/3",TMDB_KEY="68e094699525b18a70bab2f86b1fa706";
async function lazyMapping(id,s,e){const d=await json(LAZY_MAPPING_URL+"?tmdb_id="+encodeURIComponent(id)+"&tmdbId="+encodeURIComponent(id)+"&season="+s+"&episode="+e,{headers:{"Accept":"application/json","User-Agent":UA}},2500);if(!d||!d.ok||!d.mapping)return null;const m=d.mapping,mal=String(m.mal_id||m.malId||"").trim(),ep=Number(m.mal_episode||m.target_episode||0);return mal&&ep?{malId:mal,malEpisode:ep,title:String(m.anime_title||m.title||"").trim(),titles:Array.isArray(m.titles)?m.titles.filter(Boolean).map(String):[]}:null}
async function resolveTmdbId(id,type){id=String(id||"").trim();if(/^\d+$/.test(id)||!/^tt\d+$/i.test(id))return id;try{const t=String(type||"tv").toLowerCase()==="movie"?"movie_results":"tv_results",d=await json(TMDB_API+"/find/"+encodeURIComponent(id)+"?api_key="+encodeURIComponent(TMDB_KEY)+"&external_source=imdb_id",{headers:{"Accept":"application/json","User-Agent":UA}},2500);const a=d&&Array.isArray(d[t])?d[t]:[];return a[0]&&a[0].id?String(a[0].id):id}catch(e){return id}}
async function tmdbInfo(id,type){const t=String(type||"tv").toLowerCase()==="movie"?"movie":"tv",d=await json(TMDB_API+"/"+t+"/"+encodeURIComponent(id)+"?api_key="+encodeURIComponent(TMDB_KEY)+"&language=en-US",{headers:{"Accept":"application/json","User-Agent":UA}},2500);if(!d)return null;return{title:String(d.name||d.title||d.original_name||d.original_title||"").trim(),originalTitle:String(d.original_name||d.original_title||"").trim()}}
async function resolveMapping(id,s,e){const l=await lazyMapping(id,s,e);if(l){log("Lazy mapper HIT TMDB="+id+" S"+s+"E"+e+" -> MAL="+l.malId+" E"+l.malEpisode);return l}const m=await mapping(id,s,e);if(m){log("Shinkro mapper HIT TMDB="+id+" S"+s+"E"+e+" -> MAL="+m.malId+" E"+m.malEpisode);return m}return null}

async function search(query){query=String(query||"").replace(/-/g,"");if(!query)return[];return _memo("animeonsen:search:"+query.toLowerCase(),86400000,async()=>{const d=await api("/search/"+encodeURIComponent(query));if(!d||!Array.isArray(d.result))return[];return d.result.map(x=>({name:x.content_title_en||x.content_title||"",alias:String(x.content_id||""),imageUrl:x.content_id?API+"/image/210x300/"+encodeURIComponent(x.content_id):""})).filter(x=>x.alias)})}
function uniq(a){return[...new Set((a||[]).filter(Boolean).map(String))]}
function normalize(s){return String(s||"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g,"").trim()}
async function findAnime(m){const queries=uniq([m.title,...m.titles]);if(!queries.length)return null;const key="animeonsen:find:"+queries.map(normalize).sort().join("|");return _memo(key,86400000,async()=>{const batches=await _settle(queries.map(q=>()=>search(q)),4500),all=[];for(const rs of batches)for(const x of rs||[])if(!all.some(y=>y.alias===x.alias))all.push(x);for(const q of queries){const exact=all.find(x=>x.name===q);if(exact)return exact}for(const q of queries){const n=normalize(q),exact=all.find(x=>normalize(x.name)===n);if(exact)return exact}return all[0]||null})}
async function getEpisodes(alias){return _memo("animeonsen:episodes:"+alias,3600000,async()=>{const d=await api("/content/"+encodeURIComponent(alias)+"/episodes");if(!d||typeof d!=="object")return[];const out=[];for(const k of Object.keys(d)){const n=Number(k);if(!Number.isInteger(n)||n<1)continue;const x=d[k]||{};out.push({episodeNumber:n,episodeTitle:x.contentTitle_episode_en||null,episodeLink:n+"+"+alias})}return out.sort((a,b)=>a.episodeNumber-b.episodeNumber)})}
async function getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){
  const type=String(mediaType||"tv").toLowerCase();
  const rawId=String(tmdbId||"").trim(),id=await resolveTmdbId(rawId,type),s=Number(season)||1,e=Number(episode)||1;
  if(!id)return[];
  const deadline=Date.now()+14500;
  const mapped=async()=>{
    const tryOne=async m=>{
      if(!m)return null;
      const anime=await findAnime(m);
      if(!anime)return null;
      const eps=await getEpisodes(anime.alias),ep=eps.find(x=>x.episodeNumber===m.malEpisode);
      if(!ep)return null;
      const url=CDN+"/video/mp4-dash/"+encodeURIComponent(anime.alias)+"/"+encodeURIComponent(ep.episodeNumber)+"/manifest.mpd",subtitle=API+"/subtitles/"+encodeURIComponent(anime.alias)+"/en-US/"+encodeURIComponent(ep.episodeNumber);
      return[{name:"AnimeOnsen",title:"AnimeOnsen [DASH]",url,quality:"single",headers:{"Referer":SITE+"/","User-Agent":UA},subtitle,subtitleFormat:"ASS",backup:false}]
    };
    const mapSeason=type==="movie"?1:s,mapEpisode=type==="movie"?1:e;
    let m=await lazyMapping(id,mapSeason,mapEpisode),out=await tryOne(m);
    if(out)return out;
    if(m)log("Lazy mapped stream failed; trying Shinkro");
    m=await mapping(id,mapSeason,mapEpisode);out=await tryOne(m);
    if(out)return out;
    return null
  };
  try{
    const out=await _timeout(mapped(),Math.min(9000,Math.max(500,deadline-Date.now())));
    if(out&&out.length)return out
  }catch(e){log("Mapped path failed: "+e.message)}
  const fallback=async()=>{
    const info=await tmdbInfo(id,type);
    if(!info||!info.title)return[];
    const queries=uniq([info.title,info.originalTitle,type==="tv"&&s>1?info.title+" season "+s:""]);
    const batches=await _settle(queries.filter(Boolean).map(q=>()=>search(q)),3500),all=[];
    for(const rs of batches)for(const x of rs||[])if(!all.some(y=>y.alias===x.alias))all.push(x);
    let anime=null;
    for(const q of queries.filter(Boolean)){
      const n=normalize(q),x=all.find(v=>normalize(v.name)===n);
      if(x){anime=x;break}
    }
    anime=anime||all[0];
    if(!anime)return[];
    const eps=await getEpisodes(anime.alias),target=type==="movie"?1:e,ep=eps.find(x=>x.episodeNumber===target);
    if(!ep)return[];
    const url=CDN+"/video/mp4-dash/"+encodeURIComponent(anime.alias)+"/"+encodeURIComponent(ep.episodeNumber)+"/manifest.mpd",subtitle=API+"/subtitles/"+encodeURIComponent(anime.alias)+"/en-US/"+encodeURIComponent(ep.episodeNumber);
    return[{name:"AnimeOnsen",title:"AnimeOnsen [DASH]",url,quality:"single",headers:{"Referer":SITE+"/","User-Agent":UA},subtitle,subtitleFormat:"ASS",backup:false}]
  };
  try{return await _timeout(fallback(),Math.max(100,deadline-Date.now()))}catch(e){log("AnimeOnsen deadline reached: "+e.message);return[]}
}
module.exports={getStreams};
