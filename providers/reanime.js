/* Reanime provider: mapper-first (MAL->AniList via idMal) with reanime native fallback.
   Does NOT populate the mapper — read-only lookups via pending=1. */
const MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping";
const REANIME_DOMAINS=["https://reanime.to","https://reanime.cz","https://reanime.wtf"];
const FLIXCLOUD_BASE="https://flixcloud.cc";
const TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706";
const ANILIST_URL="https://graphql.anilist.co";
const UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";
const HEADERS={"User-Agent":UA,"Accept":"application/json, text/plain, */*","Accept-Language":"en-US,en;q=0.9"};
const FLIX_HEADERS={"User-Agent":UA,"Accept":"*/*","Origin":FLIXCLOUD_BASE,"Referer":FLIXCLOUD_BASE+"/"};

function log(x){console.log("[Reanime] "+x)}

class NuvioTTLCache{constructor(){this.m=new Map()}get(k){const x=this.m.get(k);if(!x)return;if(x.e<=Date.now()){this.m.delete(k);return}return x.v}set(k,v,ttl){this.m.set(k,{v,e:Date.now()+ttl});return v}delete(k){this.m.delete(k)}}
const CACHE=globalThis.__NUVIO_PROVIDER_CACHE__||(globalThis.__NUVIO_PROVIDER_CACHE__=new NuvioTTLCache());

async function memo(key,ttl,fn){const hit=CACHE.get(key);if(hit!==undefined)return hit;const p=Promise.resolve().then(fn);CACHE.set(key,p,ttl);try{const v=await p;if(v===null||v===undefined){CACHE.delete(key);return v}CACHE.set(key,v,ttl);return v}catch(e){CACHE.delete(key);throw e}}

async function timeout(p,ms){let t;try{return await Promise.race([p,new Promise((_,r)=>t=setTimeout(()=>r(new Error("timeout")),ms))])}finally{clearTimeout(t)}}

async function req(url,opt,ms){opt=opt||{};const c=new AbortController(),t=setTimeout(()=>c.abort(),ms||10000);try{return await fetch(url,Object.assign({},opt,{signal:c.signal}))}finally{clearTimeout(t)}}

async function json(url,opt,ms){try{const r=await req(url,opt,ms);if(!r||!r.ok){log("HTTP "+(r&&r.status)+" "+url.split("?")[0]);return null}return await r.json()}catch(e){log("JSON fail "+url.split("?")[0]+": "+e.message);return null}}

async function text(url,opt,ms){try{const r=await req(url,opt,ms);if(!r||!r.ok){log("HTTP "+(r&&r.status)+" "+url.split("?")[0]);return null}return await r.text()}catch(e){log("TEXT fail "+url.split("?")[0]+": "+e.message);return null}}

let activeBase=REANIME_DOMAINS[0];
async function reanimeReq(path,opt,ms){
  const ordered=activeBase?[activeBase,...REANIME_DOMAINS.filter(x=>x!==activeBase)]:REANIME_DOMAINS.slice();
  for(const base of ordered){
    try{
      const headers=Object.assign({},(opt&&opt.headers)||{});
      if(!headers["Referer"]&&!headers.referer)headers["Referer"]=base+"/";
      const r=await req(base+path,Object.assign({},opt,{headers}),ms);
      if(r&&r.ok){activeBase=base;return r}
    }catch(e){}
  }
  return null
}


/* Numeric IDs are treated as TMDB for compatibility. Use mal:12345 or
   {mal_id:12345} for explicit MyAnimeList identifiers. */
function parseAnimeIdentifier(value){
  if(value&&typeof value==="object"){
    const mal=value.mal_id??value.malId??(String(value.idType||value.id_type||"").toLowerCase()==="mal"?value.id:null);
    if(mal!=null&&/^\d{1,10}$/.test(String(mal).trim())&&Number(mal)>0)return{kind:"mal",id:String(mal).trim()};
    const tmdb=value.tmdb_id??value.tmdbId??value.id;
    return tmdb==null?{kind:"invalid",id:""}:{kind:"tmdb",id:String(tmdb).trim()};
  }
  const raw=String(value||"").trim(),m=raw.match(/^(?:mal|mal_id|malid)\s*[:#/]\s*(\d{1,10})$/i);
  if(m&&Number(m[1])>0)return{kind:"mal",id:m[1]};
  return raw?{kind:"tmdb",id:raw}:{kind:"invalid",id:""};
}

// ---------- Primary: mapper (read-only, no population trigger) ----------
async function mapperLookup(tmdbId,season,episode){
  const u=MAPPING_URL+"?tmdb_id="+encodeURIComponent(tmdbId)+"&tmdbId="+encodeURIComponent(tmdbId)+"&season="+season+"&episode="+episode+"&pending=1";
  const d=await json(u,{headers:{"Accept":"application/json","User-Agent":UA}},5000);
  if(!d)return{state:"temporary",eligibility:"unknown"};
  if(d.eligibility==="non_anime")return{state:"non_anime",eligibility:"non_anime"};
  if(!d.ok||!d.mapping)return{state:"miss",eligibility:d.eligibility||"unknown"};
  const m=d.mapping,malId=String(m.mal_id||m.malId||"").trim(),malEpisode=Number(m.mal_episode||m.target_episode||0);
  if(!malId||!Number.isInteger(malEpisode)||malEpisode<1)return{state:"miss",eligibility:d.eligibility||"anime"};
  return{state:"hit",eligibility:"anime",malId,malEpisode,title:String(m.anime_title||m.title||"").trim(),titles:Array.isArray(m.titles)?m.titles.filter(Boolean).map(String):[]}
}

async function malToAnilist(malId){
  return memo("reanime:mal2al:"+malId,604800000,async()=>{
    const q="query($idMal:Int){Media(idMal:$idMal,type:ANIME){id episodes title{english romaji native}}}";
    const d=await json(ANILIST_URL,{
      method:"POST",
      headers:Object.assign({},HEADERS,{"Content-Type":"application/json"}),
      body:JSON.stringify({query:q,variables:{idMal:parseInt(malId,10)}})
    },3500);
    if(!d||!d.data||!d.data.Media||!d.data.Media.id)return null;
    const t=d.data.Media.title||{};
    return{id:d.data.Media.id,title:t.english||t.romaji||t.native||"",episodes:Number(d.data.Media.episodes)||0}
  })
}

// ---------- Reanime API ----------
async function flixServers(anilistId,episode){
  return memo("reanime:flix:"+anilistId+":"+episode,1800000,async()=>{
    const path="/api/flix/"+encodeURIComponent(anilistId)+"/"+encodeURIComponent(episode);
    const r=await reanimeReq(path,{headers:HEADERS},3500);
    if(!r)return null;
    let d;try{d=await r.json()}catch(e){return null}
    if(!d||!Array.isArray(d.servers)||d.success===false)return null;
    return d.servers
  })
}

async function extractFlix(embedUrl){
  let embed;try{embed=new URL(String(embedUrl||""))}catch(e){return null}
  const match=embed.pathname.match(/\/(?:e|embed)\/([a-z0-9_-]+)/i);
  if(!match)return null;
  const aid=match[1];
  const t=await text(FLIXCLOUD_BASE+"/d/"+encodeURIComponent(aid)+"/__data.json",{headers:Object.assign({},FLIX_HEADERS,{Referer:embed.origin+"/"})},7000);
  if(!t)return null;
  // FlixCloud's payload has changed between serialized JSON and HTML-like
  // hydration output. Search both raw and safely decoded representations.
  let decoded=t,parsed=null;
  try{parsed=JSON.parse(t);decoded+="\n"+JSON.stringify(parsed)}catch(e){}
  decoded=decoded.replace(/\\u0022/gi,'"').replace(/\\\\\\/g,"/").replace(/\\\\"/g,'"');
  const values=[];
  const walk=(v,key="")=>{if(v==null)return;if(typeof v==="string"){values.push({key,value:v});return}if(Array.isArray(v)){for(const x of v)walk(x,key);return}if(typeof v==="object"){for(const [k,x] of Object.entries(v))walk(x,k)}};
  if(parsed)walk(parsed);
  const propertyValue=(re)=>{const x=values.find(x=>re.test(x.key)&&x.value);return x&&x.value};
  const uuid=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const jwt=/eyJ[\w-]+\.[\w-]+\.[\w-]+/;
  const fileId=(String(propertyValue(/^(?:file.?id|uuid|id)$/i)||"").match(uuid)||decoded.match(uuid)||[])[0];
  const token=(String(propertyValue(/^(?:token|jwt|access.?token)$/i)||"").match(jwt)||decoded.match(jwt)||[])[0];
  if(!fileId||!token)return null;
  const base=(decoded.match(/https:\/\/[a-z0-9.-]+\.flixcloud\.cc/i)||[])[0]||FLIXCLOUD_BASE;
  const q=(decoded.match(/(\d{3,4}p)/i)||[])[0]||"1080p";
  const size=(decoded.match(/"(\d+(?:\.\d+)?\s*[KMG]B)"/i)||[])[1]||"Unknown";
  let url;try{url=new URL("/download/"+fileId,base);url.searchParams.set("token",token)}catch(e){return null}
  const headers={"User-Agent":UA,"Accept":"*/*","Origin":embed.origin,"Referer":embed.toString()};
  return{url:url.toString(),quality:q,size,headers}
}

// ---------- Fallback: reanime native search ----------
async function tmdbInfo(tmdbId,mediaType){
  return memo("reanime:tmdb:"+mediaType+":"+tmdbId,86400000,async()=>{
    const type=mediaType==="movie"?"movie":"tv";
    const url="https://api.themoviedb.org/3/"+type+"/"+encodeURIComponent(tmdbId)+"?api_key="+TMDB_API_KEY+"&language=en-US";
    const d=await json(url,{headers:{"Accept":"application/json","User-Agent":UA}},3500);
    if(!d)return null;
    return{title:d.name||d.title||d.original_name||d.original_title||"",originalTitle:d.original_name||d.original_title||""}
  })
}

function extractAnilistId(item){
  const direct=item&&(item.anilist_id||item.anilistId);
  if(direct)return String(direct);
  const urls=[
    item&&item.cover_image&&item.cover_image.extra_large,
    item&&item.cover_image&&item.cover_image.large,
    item&&item.cover_image&&item.cover_image.medium,
    item&&item.banner_image
  ].filter(Boolean);
  for(const u of urls){
    const m=String(u).match(/\/b?x?(\d+)-|\/(\d+)[-.]/);
    if(m)return m[1]||m[2]
  }
  return null
}

async function searchReanime(query){
  return memo("reanime:search:"+query.toLowerCase(),86400000,async()=>{
    const paths=["/api/v1/search?q="+encodeURIComponent(query)+"&limit=36","/api/search?q="+encodeURIComponent(query)];
    for(const path of paths){
      const r=await reanimeReq(path,{headers:HEADERS},3500);
      if(!r)continue;
      const t=await r.text().catch(()=>"");
      if(!t)continue;
      const trim=t.trim();
      if(trim[0]!=="{"&&trim[0]!=="[")continue;
      let d;try{d=JSON.parse(t)}catch(e){continue}
      const list=d.results||d.data||d.anime||(Array.isArray(d)?d:null);
      if(!Array.isArray(list))continue;
      const out=[];
      for(const item of list){
        if(!item)continue;
        const rawSlug=item.anime_id||item.slug||item.id||item.url;
        if(!rawSlug)continue;
        const alId=extractAnilistId(item);
        if(!alId)continue;
        const titles=[];
        if(item.title&&typeof item.title==="object"){
          if(item.title.english)titles.push(item.title.english);
          if(item.title.romaji)titles.push(item.title.romaji);
          if(item.title.native)titles.push(item.title.native)
        }else if(typeof item.title==="string")titles.push(item.title);
        if(item.name)titles.push(item.name);
        out.push({slug:String(rawSlug),titles,title:titles[0]||String(rawSlug),anilistId:String(alId)})
      }
      if(out.length)return out
    }
    return[]
  })
}

function normTitle(s){return String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")}

function scoreTitle(candidate,info){
  const targets=[info.title,info.originalTitle,...(info.aliases||[])].filter(Boolean).map(normTitle).filter(Boolean);
  const names=(candidate.titles||[]).map(normTitle).filter(Boolean);
  return names.some(n=>targets.includes(n))?100:0;
}

async function anilistDetails(alId){
  const q="query($id:Int){Media(id:$id,type:ANIME){id episodes title{english romaji native}}}";
  const d=await json(ANILIST_URL,{method:"POST",headers:Object.assign({},HEADERS,{"Content-Type":"application/json"}),body:JSON.stringify({query:q,variables:{id:parseInt(alId,10)}})},3500);
  const m=d&&d.data&&d.data.Media;
  return m&&m.id?{id:m.id,episodes:Number(m.episodes)||0,title:(m.title&&(m.title.english||m.title.romaji||m.title.native))||""}:null;
}

async function resolveNative(tmdbId,mediaType,season,episode,prefetchedInfo,eligibility){
  // Native fallback is permitted only for confirmed anime. A mapping miss or a
  // timeout is not itself evidence of anime eligibility.
  if(eligibility!=="anime")return null;
  if(mediaType!=="movie"&&Number(season)!==1)return null;
  const info=prefetchedInfo||await tmdbInfo(tmdbId,mediaType);
  if(!info||!info.title)return null;
  const queries=[info.title];
  if(info.originalTitle&&info.originalTitle!==info.title)queries.push(info.originalTitle);
  const all=[];
  const results=await Promise.all(queries.map(q=>searchReanime(q).catch(()=>[])));
  for(const r of results)for(const x of r)if(!all.some(y=>y.anilistId===x.anilistId))all.push(x);
  const scored=all.map(x=>({x,score:scoreTitle(x,info)})).filter(x=>x.score===100);
  if(!scored.length)return null;
  const ids=[...new Set(scored.map(x=>x.x.anilistId))];
  if(ids.length!==1)return null;
  const candidate=scored.find(x=>x.x.anilistId===ids[0]).x;
  const details=await anilistDetails(candidate.anilistId);
  if(!details)return null;
  const targetEpisode=mediaType==="movie"?1:Number(episode);
  if(!Number.isInteger(targetEpisode)||targetEpisode<1)return null;
  if(mediaType!=="movie"&&(!details.episodes||targetEpisode>details.episodes))return null;
  return{alId:candidate.anilistId,title:candidate.title||details.title||info.title,episode:targetEpisode,malId:null};
}

async function buildStreams(resolved,mediaType){
  const servers=await flixServers(resolved.alId,resolved.episode).catch(()=>null);
  if(!Array.isArray(servers)||!servers.length)return[];
  const audioKind=s=>{const v=String(s&& (s.dataType||s.type||s.language)||"").toLowerCase();if(/^(sub|subbed|subtitle|jpn|ja)$/.test(v))return"sub";if(/^(dub|dubbed|english|eng|en)$/.test(v))return"dub";return""};
  const subList=servers.filter(s=>audioKind(s)==="sub");
  const dubList=servers.filter(s=>audioKind(s)==="dub");
  const tasks=[];
  const displayTitle=resolved.title||"Anime";
  const queue=(list,lang)=>{
    if(!Array.isArray(list))return;
    const langUpper=lang.toUpperCase();
    for(let i=0;i<list.length;i++){
      const sv=list[i];
      if(!sv||!sv.dataLink)continue;
      const serverName=sv.serverName||("HD-"+(i+1));
      const title=mediaType==="movie"
        ?displayTitle+" ("+langUpper+")"
        :displayTitle+" - Episode "+resolved.episode+" ("+langUpper+")";
      tasks.push((async()=>{
        const dl=await extractFlix(sv.dataLink).catch(()=>null);
        if(!dl||!dl.url)return null;
        return{
          name:"Reanime ["+langUpper+"] "+serverName+" ("+(dl.quality||"1080p")+")",
          title,
          url:dl.url,
          quality:dl.quality||"1080p",
          size:dl.size||"Unknown",
          headers:dl.headers,
          provider:"reanime",
          type:"mkv"
        }
      })())
    }
  };
  queue(subList,"sub");
  queue(dubList,"dub");
  if(!tasks.length)return[];
  const results=await Promise.all(tasks);
  const seen=new Set(),streams=[];
  for(const r of results)if(r&&r.url&&!seen.has(r.url)){seen.add(r.url);streams.push(r)}
  const qr={"2160p":2160,"4k":2160,"1080p":1080,"720p":720,"480p":480,"360p":360};
  streams.sort((a,b)=>(qr[(b.quality||"").toLowerCase()]||0)-(qr[(a.quality||"").toLowerCase()]||0));
  return streams
}

async function getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){
  try{
    const type=String(mediaType||"tv").toLowerCase(),identifier=parseAnimeIdentifier(tmdbId),id=identifier.id;
    if(!id||identifier.kind==="invalid"||(identifier.kind==="mal"&&type!=="tv"))return[];
    const s=Number(season)||1,e=Number(episode)||1;
    if(!Number.isInteger(e)||e<1||e>100000)return[];
    const mapSeason=type==="movie"?1:s,mapEpisode=type==="movie"?1:e;
    const key="reanime:streams:"+identifier.kind+":"+id+":"+type+":"+s+":"+e;
    const hit=CACHE.get(key);if(hit!==undefined)return hit;
    const p=(async()=>{
      // Direct MAL requests skip TMDB mapping entirely; the requested episode is
      // interpreted as a MAL episode number for that exact MAL anime entry.
      const tmdbPromise=identifier.kind==="mal"?Promise.resolve(null):tmdbInfo(id,type).catch(()=>null);
      let resolved=null,source=identifier.kind==="mal"?"mal":"mapper",eligibility=identifier.kind==="mal"?"anime":"unknown";
      try{
        if(identifier.kind==="mal") {
          const al=await timeout(malToAnilist(id),5000);
          if(al&&(!al.episodes||e<=al.episodes))resolved={alId:al.id,title:al.title||"MAL "+id,episode:e,malId:id};
          else if(al)log("Requested MAL episode exceeds AniList episode count MAL="+id+" E"+e+" total="+al.episodes);
          else log("Direct MAL->AniList resolution failed MAL="+id);
        } else {
        const m=await timeout(mapperLookup(id,mapSeason,mapEpisode),5000);
        if(m){
          eligibility=m.eligibility||"unknown";
          if(m.state==="non_anime"){
            log("Confirmed non-anime; native fallback blocked TMDB="+id);
            return[];
          }
          if(m.state==="hit"){
            const al=await timeout(malToAnilist(m.malId),3500);
            if(al){
              resolved={alId:al.id,title:m.title||al.title,episode:m.malEpisode,malId:m.malId};
              eligibility="anime";
              log("Mapper hit MAL="+m.malId+" AL="+al.id+" E"+m.malEpisode);
            }else log("Mapper hit but MAL->AL failed MAL="+m.malId);
          }else log("Mapper miss TMDB="+id+" S"+s+"E"+e+" eligibility="+eligibility);
        }
        }
      }catch(err){log("Identifier resolution error: "+err.message)}
      let streams=[];
      if(resolved){
        try{streams=await timeout(buildStreams(resolved,type),10000)}
        catch(err){log("Mapper streams error: "+err.message)}
      }
      if(!streams.length&&eligibility==="anime"&&identifier.kind!=="mal"){
        log("Trying strict native fallback for confirmed anime");
        source="native";
        try{
          const info=await timeout(tmdbPromise,3500);
          const native=await timeout(resolveNative(id,type,s,e,info,eligibility),7000);
          if(native){resolved=native;streams=await timeout(buildStreams(native,type),10000)}
        }catch(err){log("Native error: "+err.message)}
      }
      log("Done streams="+streams.length+" src="+source);
      return streams
    })();
    CACHE.set(key,p,1800000);
    try{const out=await p;if(out&&out.length)CACHE.set(key,out,1800000);else CACHE.delete(key);return out}
    catch(err){CACHE.delete(key);return[]}
  }catch(err){log("Fatal: "+(err&&err.message||err));return[]}
}

module.exports={getStreams};
