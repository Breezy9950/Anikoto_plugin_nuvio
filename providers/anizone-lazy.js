const BASE="https://anizone.to",MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping",POPULATE_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-populate-background",UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36",HEADERS={"Referer":BASE+"/","User-Agent":UA},TIMEOUT=15000;

async function req(url,opt={},timeout=TIMEOUT){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
  try{return await fetch(url,{...opt,signal:c.signal,headers:{...HEADERS,...(opt.headers||{})}})}
  catch(e){return null}
  finally{clearTimeout(t)}
}

async function text(url,opt={},timeout=TIMEOUT){
  const r=await req(url,opt,timeout);
  if(!r||!r.ok)return"";
  try{return await r.text()}catch(e){return""}
}

async function json(url,opt={},timeout=TIMEOUT){
  const r=await req(url,opt,timeout);
  if(!r||!r.ok)return null;
  try{return await r.json()}catch(e){return null}
}

function attrs(s){
  const o={};
  String(s||"").replace(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,(m,k,a,b,c)=>{o[k]=a!=null?a:b!=null?b:c!=null?c:"";return m});
  return o
}

function parseHTML(html){
  const root={type:"root",children:[]},stack=[root],src=String(html||"");
  const re=/<\/?([a-zA-Z0-9:-]+)([^>]*)>/g;
  let last=0,m;
  while((m=re.exec(src))){
    if(m.index>last){
      const tx=src.slice(last,m.index);
      if(tx)stack[stack.length-1].children.push({type:"text",text:tx})
    }
    const full=m[0],name=m[1].toLowerCase();
    if(full[1]==="/"){
      for(let i=stack.length-1;i>0;i--){
        if(stack[i].name===name){
          stack.length=i;
          break
        }
      }
    }else if(full[1]!=="!"){
      const n={type:"element",name,attrs:attrs(m[2]),children:[]};
      stack[stack.length-1].children.push(n);
      if(!/\/>$/.test(full)&&!["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"].includes(name))stack.push(n)
    }
    last=re.lastIndex
  }
  if(last<src.length)stack[stack.length-1].children.push({type:"text",text:src.slice(last)});
  return root
}

function children(n){return n&&n.children||[]}

function match(n,sel){
  if(!n||n.type!=="element")return false;
  if(sel.startsWith("#"))return n.attrs.id===sel.slice(1);
  if(sel.startsWith("."))return String(n.attrs.class||"").split(/\s+/).includes(sel.slice(1));
  if(sel.startsWith("[")){
    const m=sel.match(/^\[([^\]=~*^$]+)(?:([~*^$]?=)["']?([^"'\]]+)["']?)?\]$/);
    if(!m)return false;
    const v=n.attrs[m[1]];
    if(v==null)return false;
    if(!m[2])return true;
    if(m[2]==="=")return v===m[3];
    if(m[2]==="*=")return v.includes(m[3]);
    if(m[2]==="~=")return v.split(/\s+/).includes(m[3]);
    if(m[2]==="^=")return v.startsWith(m[3]);
    if(m[2]==="$=")return v.endsWith(m[3])
  }
  return n.name===sel.toLowerCase()
}

function all(root,sel){
  const out=[];
  function walk(n){
    if(n&&n.type==="element"&&match(n,sel))out.push(n);
    for(const c of children(n))walk(c)
  }
  walk(root);
  return out
}

function first(root,sel){return all(root,sel)[0]||null}

function nodeText(n){
  if(!n)return"";
  if(n.type==="text")return n.text||"";
  return children(n).map(nodeText).join("")
}

function attr(n,k){return n&&n.attrs?n.attrs[k]:undefined}

function sanitizeJson(s){
  return String(s||"")
    .replace(/\\u0022/g,'"')
    .replace(/\\u0026/g,"&")
    .replace(/\\'/g,"'")
    .replace(/\\\//g,"/")
    .replace(/\\\\/g,"\\")
    .replace(/\\&/g,"&")
    .replace(/\\0/g,"\\u0000")
    .replace(/\\x([0-9a-fA-F]{2})/g,(_,h)=>"\\u00"+h)
    .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g,"")
}

function decodeJSON(s){
  try{return JSON.parse(sanitizeJson(s))}
  catch(e){return null}
}

function parseCards(html){
  const cards=[],src=String(html||"");
  const m=src.match(/items:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/s);
  if(m){
    const d=decodeJSON(m[1]);
    if(Array.isArray(d)){
      for(const x of d){
        if(x&&typeof x==="object")cards.push(x)
      }
    }
  }
  if(cards.length)return cards;
  const root=parseHTML(src);
  for(const n of all(root,"a")){
    const x=attr(n,"x-data")||"";
    if(x.includes("anmTitles")){
      cards.push({
        slug:(attr(n,"href")||"").replace(/^\/anime\//,"").replace(/\/$/,""),
        title:nodeText(n).trim()
      })
    }
  }
  return cards
}

function cardSlug(c){
  if(!c)return"";
  return String(c.slug||c.url||c.href||c.link||"").replace(/^https?:\/\/[^/]+/,"").replace(/^\/anime\//,"").replace(/^\/+/,"").replace(/\/+$/,"")
}

function cardTitle(c){
  if(!c)return"";
  return String(c.title||c.name||c.anime_title||c.animeTitle||c.en||c.romaji||"").trim()
}

function normalizeTitle(s){
  return String(s||"").toLowerCase().replace(/&amp;/g,"&").replace(/[’'`]/g,"").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim()
}

function titleWords(s){
  return normalizeTitle(s).split(" ").filter(Boolean)
}

function titleScore(a,b){
  const aa=normalizeTitle(a),bb=normalizeTitle(b);
  if(!aa||!bb)return 0;
  if(aa===bb)return 100;
  if(aa.includes(bb)||bb.includes(aa))return 80;
  const aw=titleWords(aa),bw=titleWords(bb);
  let hits=0;
  for(const w of aw)if(w.length>1&&bw.includes(w))hits++;
  return Math.round(hits/Math.max(aw.length,bw.length)*70)
}

function seasonPatterns(season){
  const s=Number(season)||1;
  if(s<=1)return[];
  return[
    new RegExp("\\bseason\\s*"+s+"\\b","i"),
    new RegExp("\\b"+s+"(?:st|nd|rd|th)\\s+season\\b","i"),
    new RegExp("\\bs"+s+"\\b","i"),
    new RegExp("\\bpart\\s*"+s+"\\b","i"),
    new RegExp("\\b"+s+"\\b","i")
  ]
}

function matchCard(cards,title,season){
  if(!cards||!cards.length)return null;
  const s=Number(season)||1;
  let best=null,bestScore=-1;
  for(const c of cards){
    const ct=cardTitle(c);
    if(!ct)continue;
    let score=titleScore(title,ct);
    if(s>1){
      let hasSeason=false;
      for(const p of seasonPatterns(s))if(p.test(ct)){hasSeason=true;break}
      score+=hasSeason?35:-15
    }
    if(score>bestScore){
      bestScore=score;
      best=c
    }
  }
  return bestScore>=35?best:null
}

function matchMovieCard(cards,title){
  if(!cards||!cards.length)return null;
  let best=null,bestScore=-1;
  for(const c of cards){
    const score=titleScore(title,cardTitle(c));
    if(score>bestScore){
      bestScore=score;
      best=c
    }
  }
  return bestScore>=35?best:null
}

async function searchCards(query){
  if(!query)return[];
  const url=BASE+"/anime?search="+encodeURIComponent(query)+"&sort=title-asc";
  const h=await text(url,{headers:HEADERS},10000);
  if(!h)return[];
  return parseCards(h)
}

function parseVidstackFromHtml(html){
  const root=parseHTML(html),out=[];
  const m=String(html||"").match(/vidstackPlayer$begin:math:text$JSON\\\.parse\\\(\'\(\(\?\:\[\^\'\\\\\]\|\\\\\.\)\*\)\'$end:math:text$\)/);
  if(m){
    const d=decodeJSON(m[1]);
    if(d){
      if(Array.isArray(d))out.push(...d);
      else if(Array.isArray(d.sources))out.push(...d.sources);
      else if(d.source)out.push(d.source);
      else out.push(d)
    }
  }
  for(const p of all(root,"media-player")){
    const src=attr(p,"src");
    if(src)out.push({src,type:attr(p,"type")||"application/x-mpegURL"})
  }
  const ms=String(html||"").match(/https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*/g)||[];
  for(const u of ms)out.push({src:u,type:"application/x-mpegURL"});
  const tracks=[];
  for(const t of all(root,"track")){
    const u=attr(t,"src");
    if(u)tracks.push({url:u,lang:attr(t,"srclang")||attr(t,"label")||""})
  }
  return{sources:out,subtitles:tracks}
}

function normalizeStream(x){
  if(!x)return null;
  if(typeof x==="string")return/^https?:\/\//i.test(x)?{url:x}:null;
  const u=x.url||x.src||x.file||x.href;
  if(!u||!/^https?:\/\//i.test(String(u)))return null;
  return{url:String(u),type:x.type||"application/x-mpegURL",quality:x.quality||x.label||""}
}

function audioFormat(s){
  const x=String(s||"").toLowerCase();
  if(x.includes("multi"))return"Multi";
  if(x.includes("dub")||x.includes("english"))return"English";
  return"Japanese"
}

async function episodePage(slug,ep){
  const url=BASE+"/anime/"+slug+"/"+ep;
  const r=await req(url,{headers:HEADERS},TIMEOUT);
  if(!r||!r.ok)return null;
  let html="";
  try{html=await r.text()}catch(e){return null}
  const sc=r.headers&&r.headers.get?r.headers.get("set-cookie"):"";
  return{html,cookie:sc||""}
}

async function getTmdbInfo(tmdbId,mediaType){
  const url=mediaType==="movie"
    ?"https://api.themoviedb.org/3/movie/"+encodeURIComponent(tmdbId)+"?language=en-US"
    :"https://api.themoviedb.org/3/tv/"+encodeURIComponent(tmdbId)+"?language=en-US";
  const r=await req(url,{headers:{"Accept":"application/json"}},10000);
  if(!r||!r.ok)return null;
  try{return await r.json()}catch(e){return null}
}

async function dbMapping(tmdbId,season,episode){
  tmdbId=String(tmdbId||"").trim();
  season=Number(season)||1;
  episode=Number(episode)||1;
  if(!tmdbId){
    console.log("[AniZone Lazy] REFUSING EMPTY TMDB ID");
    return null
  }

  console.log("[AniZone Lazy] DB lookup",{tmdb_id:tmdbId,season,episode});

  const u=MAPPING_URL+
    "?tmdb_id="+encodeURIComponent(tmdbId)+
    "&tmdbId="+encodeURIComponent(tmdbId)+
    "&season="+encodeURIComponent(season)+
    "&episode="+encodeURIComponent(episode);

  const d=await json(u,{headers:{"Accept":"application/json"}},10000);

  if(d&&d.ok&&d.mapping){
    console.log("[AniZone Lazy] DB HIT",d.mapping);
    return{mapping:d.mapping,fromDb:true}
  }

  console.log("[AniZone Lazy] DB MISS",d);
  return null
}

async function fallbackMapping(tmdbId,season,episode){
  tmdbId=String(tmdbId||"").trim();
  season=Number(season)||1;
  episode=Number(episode)||1;

  if(!tmdbId){
    console.log("[AniZone Lazy] REFUSING FALLBACK WITH EMPTY TMDB ID");
    return null
  }

  console.log("[AniZone Lazy] FALLBACK MAPPING",{tmdb_id:tmdbId,season,episode});

  const u=MAPPING_URL+
    "?resolve=1"+
    "&tmdb_id="+encodeURIComponent(tmdbId)+
    "&tmdbId="+encodeURIComponent(tmdbId)+
    "&season="+encodeURIComponent(season)+
    "&episode="+encodeURIComponent(episode);

  const d=await json(u,{headers:{"Accept":"application/json"}},20000);

  if(d&&d.ok&&d.mapping){
    console.log("[AniZone Lazy] FALLBACK MAPPING HIT",d.mapping);
    return{mapping:d.mapping,fromDb:false}
  }

  console.log("[AniZone Lazy] FALLBACK MAPPING FAILED",d);
  return null
}

function triggerPopulation(seed){
  if(!seed||!seed.tmdb_id){
    console.log("[AniZone Lazy] POPULATION NOT STARTED: INVALID SEED",seed);
    return
  }

  console.log("[AniZone Lazy] START BACKGROUND POPULATION",seed);

  try{
    void fetch(POPULATE_URL,{
      method:"POST",
      headers:{
        ...HEADERS,
        "Content-Type":"application/json",
        "Accept":"application/json"
      },
      body:JSON.stringify(seed)
    }).then(r=>{
      console.log("[AniZone Lazy] BACKGROUND POPULATION REQUEST STATUS",r&&r.status);
      return r
    }).catch(e=>{
      console.log("[AniZone Lazy] BACKGROUND POPULATION REQUEST FAILED",String(e))
    })
  }catch(e){
    console.log("[AniZone Lazy] BACKGROUND POPULATION LAUNCH FAILED",String(e))
  }
}

function mappingTitle(mapping){
  return String(mapping&&(mapping.anime_title||mapping.title||mapping.name||mapping.mal_title)||"").trim()
}

function mappingEpisode(mapping,requestedEpisode){
  const v=mapping&&(mapping.mal_episode!=null?mapping.mal_episode:mapping.episode!=null?mapping.episode:mapping.malEpisode);
  const n=Number(v);
  return Number.isFinite(n)&&n>0?n:Number(requestedEpisode)||1
}

function mappingMalId(mapping){
  const v=mapping&&(mapping.mal_id!=null?mapping.mal_id:mapping.malId!=null?mapping.malId:mapping.id);
  return v==null?"":String(v)
}

function mappingImdb(mapping){
  return String(mapping&&(mapping.imdb_id||mapping.imdbId||mapping.imdb)||"")
}

async function resolveStream(tmdbId,mediaType,season,episode){
  tmdbId=String(tmdbId||"").trim();
  mediaType=String(mediaType||"tv");
  season=Number(season)||1;
  episode=Number(episode)||1;

  console.log("[AniZone Lazy] REQUEST",{
    tmdbId,
    mediaType,
    season,
    episode
  });

  if(!tmdbId){
    console.log("[AniZone Lazy] ABORT: EMPTY TMDB ID");
    return[]
  }

  const isMovie=mediaType==="movie";
  let mappingResult=null;
  let title="";
  let malEpisode=1;
  let malId="";
  let imdbId="";

  if(!isMovie){
    mappingResult=await dbMapping(tmdbId,season,episode);
    if(!mappingResult)mappingResult=await fallbackMapping(tmdbId,season,episode);

    if(!mappingResult||!mappingResult.mapping){
      console.log("[AniZone Lazy] NO MAPPING AVAILABLE");
      return[]
    }

    const mapping=mappingResult.mapping;

    title=mappingTitle(mapping);
    malEpisode=mappingEpisode(mapping,episode);
    malId=mappingMalId(mapping);
    imdbId=mappingImdb(mapping);

    if(!mappingResult.fromDb){
      triggerPopulation({
        tmdb_id:String(mapping.tmdb_id||mapping.tmdbId||tmdbId),
        imdb_id:imdbId,
        mal_id:malId,
        title:title,
        season:season,
        episode:episode,
        mal_episode:malEpisode
      })
    }
  }else{
    const info=await getTmdbInfo(tmdbId,"movie");
    if(!info)return[];
    title=String(info.title||info.original_title||"").trim();
    imdbId=String(info.imdb_id||"");
    malEpisode=1;
    if(!title)return[]
  }

  if(!title){
    console.log("[AniZone Lazy] EMPTY TITLE AFTER MAPPING");
    return[]
  }

  console.log("[AniZone Lazy] SEARCH",{
    title,
    season,
    episode,
    mal_episode:malEpisode
  });

  let cards=await searchCards(title);

  if(!cards.length){
    const info=await getTmdbInfo(tmdbId,mediaType);
    if(info){
      const alt=[
        info.name,
        info.original_name,
        info.title,
        info.original_title
      ].filter(Boolean);

      for(const q of alt){
        if(normalizeTitle(q)===normalizeTitle(title))continue;
        cards=await searchCards(q);
        if(cards.length)break
      }
    }
  }

  if(!cards.length){
    console.log("[AniZone Lazy] SEARCH EMPTY",title);
    return[]
  }

  const card=isMovie?matchMovieCard(cards,title):matchCard(cards,title,season);

  if(!card){
    console.log("[AniZone Lazy] CARD NOT FOUND",{
      title,
      season,
      results:cards.length
    });
    return[]
  }

  const slug=cardSlug(card);

  if(!slug){
    console.log("[AniZone Lazy] CARD HAS NO SLUG",card);
    return[]
  }

  console.log("[AniZone Lazy] CARD MATCH",{
    title:cardTitle(card),
    slug,
    mal_episode:malEpisode
  });

  const page=await episodePage(slug,malEpisode);

  if(!page){
    console.log("[AniZone Lazy] EPISODE PAGE FAILED",{slug,episode:malEpisode});
    return[]
  }

  const parsed=parseVidstackFromHtml(page.html);
  const streams=[];
  const seen=new Set();

  for(const s of parsed.sources||[]){
    const n=normalizeStream(s);
    if(!n||seen.has(n.url))continue;

    seen.add(n.url);

    streams.push({
      ...n,
      title:"AniZone",
      name:"AniZone",
      behaviorHints:{
        ...(n.behaviorHints||{}),
        bingeGroup:"anizone"
      },
      subtitles:parsed.subtitles||[],
      audio:audioFormat(n.label||n.quality||"")
    })
  }

  const root=parseHTML(page.html);
  const buttons=all(root,"button");

  for(let i=0;i<buttons.length;i++){
    const btn=buttons[i];
    const vm=String(attr(btn,"wire:click")||"").match(/setVideo$begin:math:text$\(\\d\+\)$end:math:text$/);
    if(!vm)continue;

    const videoId=vm[1];

    try{
      const csrf=String(attr(first(root,'meta[name="csrf-token"]'),"content")||"");
      const snapshotNode=first(root,"[wire:snapshot]");
      const snapshot=attr(snapshotNode,"wire:snapshot")||"";
      const componentId=attr(first(root,"[wire:id]"),"wire:id")||"";

      const body={
        components:[{
          snapshot:snapshot,
          updates:[],
          calls:[{
            path:"",
            method:"setVideo",
            params:[Number(videoId)]
          }]
        }]
      };

      const extraHeaders={
        ...HEADERS,
        "Content-Type":"application/json",
        "X-Livewire":"true",
        "X-Requested-With":"XMLHttpRequest"
      };

      if(csrf)extraHeaders["X-CSRF-TOKEN"]=csrf;
      if(page.cookie)extraHeaders.Cookie=page.cookie;
      if(componentId)extraHeaders["X-Livewire-Id"]=componentId;

      const r=await req(BASE+"/livewire/update",{
        method:"POST",
        headers:extraHeaders,
        body:JSON.stringify(body)
      },10000);

      if(!r||!r.ok)continue;

      let h="";
      try{h=await r.text()}catch(e){continue}

      const p=parseVidstackFromHtml(h);

      for(const s of p.sources||[]){
        const n=normalizeStream(s);
        if(!n||seen.has(n.url))continue;

        seen.add(n.url);

        streams.push({
          ...n,
          title:"AniZone",
          name:"AniZone",
          behaviorHints:{
            ...(n.behaviorHints||{}),
            bingeGroup:"anizone"
          },
          subtitles:p.subtitles&&p.subtitles.length?p.subtitles:parsed.subtitles||[],
          audio:audioFormat(n.label||n.quality||"")
        })
      }
    }catch(e){
      console.log("[AniZone Lazy] LIVEWIRE SERVER FAILED",videoId,String(e))
    }
  }

  console.log("[AniZone Lazy] STREAMS FOUND",{
    title,
    slug,
    episode:malEpisode,
    count:streams.length
  });

  return streams
}

async function getStreams(tmdbId,mediaType,season,episode,settings){
  try{
    return await resolveStream(
      String(tmdbId||""),
      String(mediaType||"tv"),
      Number(season)||1,
      Number(episode)||1
    )
  }catch(e){
    console.log("[AniZone Lazy] ERROR",String(e));
    return[]
  }
}

module.exports={getStreams};
