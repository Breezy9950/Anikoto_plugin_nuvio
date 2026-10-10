const BASE="https://anizone.to",MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping",ANIZIP_BASE="https://api.ani.zip",TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706",UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36",HEADERS={"User-Agent":UA,"Referer":BASE+"/"},TIMEOUT=15000;

async function req(url,opt={},timeout=TIMEOUT){
  const o={...opt,headers:{...HEADERS,...(opt.headers||{})}};
  if(typeof AbortController!=="function"||typeof setTimeout!=="function")return fetch(url,o).catch(()=>null);
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
  try{return await fetch(url,{...o,signal:c.signal})}catch(e){return null}finally{clearTimeout(t)}
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
  const root={type:"root",children:[]},stack=[root],src=String(html||""),re=/<\/?([a-zA-Z0-9:-]+)([^>]*)>/g;
  let last=0,m;
  while((m=re.exec(src))){
    if(m.index>last)stack[stack.length-1].children.push({type:"text",text:src.slice(last,m.index)});
    const full=m[0],name=m[1].toLowerCase();
    if(full[1]==="/"){
      for(let i=stack.length-1;i>0;i--)if(stack[i].name===name){stack.length=i;break}
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
  if(sel[0]==="#")return n.attrs.id===sel.slice(1);
  if(sel[0]===".")return String(n.attrs.class||"").split(/\s+/).includes(sel.slice(1));
  if(sel[0]==="["){
    const m=sel.match(/^\[([^\\]=~*^$]+)(?:([~*^$]?=)["']?([^"'\\]]+)["']?)?\]$/);
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
  try{return JSON.parse(sanitizeJson(s))}catch(e){return null}
}

function parseCards(html){
  const cards=[],src=String(html||""),m=src.match(/items:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
  if(m){
    const d=decodeJSON(m[1]);
    if(Array.isArray(d)){
      for(const x of d){
        if(!x||!x.slug)continue;
        const titles=new Set();
        if(x.main_title)titles.add(String(x.main_title));
        if(x.title_list&&typeof x.title_list==="object")for(const t of Object.values(x.title_list))if(t)titles.add(String(t));
        if(x.title)titles.add(String(x.title));
        cards.push({slug:String(x.slug),url:x.url||"/anime/"+x.slug,titles:Array.from(titles)})
      }
    }
  }
  if(cards.length)return cards;
  const root=parseHTML(src);
  for(const n of all(root,"[x-data]")){
    const xd=String(attr(n,"x-data")||"");
    if(!xd.includes("anmTitles"))continue;
    const links=all(n,"a");
    const a=links.find(x=>String(attr(x,"href")||"").includes("/anime/"))||null;
    const href=attr(a,"href")||"";
    if(!href.includes("/anime/"))continue;
    const p=href.split("/").filter(Boolean),slug=p[p.length-1]||"";
    if(!slug)continue;
    const titles=new Set();
    if(a){
      const t=nodeText(a).trim();
      if(t)titles.add(t)
    }
    const jm=xd.match(/JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
    if(jm){
      const d=decodeJSON(jm[1]);
      if(d&&typeof d==="object")for(const t of Object.values(d))if(t)titles.add(String(t))
    }
    cards.push({slug,titles:Array.from(titles)})
  }
  return cards
}

function cardSlug(c){
  if(!c)return"";
  return String(c.slug||c.url||c.href||c.link||"")
    .replace(/^https?:\/\/[^/]+/,"")
    .replace(/^\/anime\//,"")
    .replace(/^\/+/,"")
    .replace(/\/+$/g,"")
}

function cardTitles(c){
  if(!c)return[];
  const out=[];
  if(Array.isArray(c.titles))out.push(...c.titles);
  for(const k of ["main_title","title","name","anime_title","animeTitle","en","english","romaji","original_title","originalTitle"])if(c[k])out.push(c[k]);
  if(c.title_list&&typeof c.title_list==="object")out.push(...Object.values(c.title_list));
  return[...new Set(out.map(x=>String(x||"").trim()).filter(Boolean))]
}

function cardTitle(c){return cardTitles(c)[0]||""}

function normalize(s){
  return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"").trim()
}

function seasonRules(season){
  const s=Number(season)||1;
  if(s===1)return{mustNot:[
    /season\s*[2-9]/i,
    /saison\s*[2-9]/i,
    /[\s\-][iI]{2,}/,
    /\s+[2-9]nd/i,
    /\s+[2-9]rd/i,
    /\s+[2-9]th/i,
    /\s+ii\b/i,
    /\s+iii\b/i,
    /\s+iv\b/i,
    /\s+v\b/i,
    /movie/i,
    /gekijouban/i,
    /the movie/i
  ]};
  if(s===2)return{must:[/season\s*2/i,/saison\s*2/i,/2nd\s*season/i,/[\s\-]ii\b/i,/\b2\b/]};
  if(s===3)return{must:[/season\s*3/i,/saison\s*3/i,/3rd\s*season/i,/[\s\-]iii\b/i,/\b3\b/]};
  if(s===4)return{must:[/season\s*4/i,/saison\s*4/i,/4th\s*season/i,/[\s\-]iv\b/i,/\b4\b/,/final\s*season/i]};
  return{must:[
    new RegExp("(?:season|saison)\\s*"+s,"i"),
    new RegExp("\\b"+s+"\\b")
  ]}
}

function matchCard(cards,targetTitles,baseTitle,season=1,seasonName="",episodeTitle=""){
  const normalizeTitle=v=>String(v||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
  const targets=[...new Set((targetTitles||[]).map(normalizeTitle).filter(Boolean))];
  const base=normalizeTitle(baseTitle),sn=normalizeTitle(seasonName),en=normalizeTitle(episodeTitle),seasonNo=Number.isInteger(Number(season))&&Number(season)>=0?Number(season):1;
  const scored=[];
  for(const c of cards){
    const titles=cardTitles(c).map(normalizeTitle).filter(Boolean);
    if(!titles.length)continue;
    let identity=0,seasonEvidence=0;
    for(const n of titles){
      if(targets.includes(n))identity=Math.max(identity,100);
      // Allow a provider's season-qualified title only when the mapped canonical title
      // is a complete title component, not an arbitrary substring.
      if(targets.some(t=>n===t+" "+sn||n===sn+" "+t))identity=Math.max(identity,120);
      if(base&&(n===base||n.startsWith(base+" ")||n.endsWith(" "+base)))identity=Math.max(identity,75);
      if(sn&&sn!=="season "+seasonNo&&(n===sn||n.endsWith(" "+sn)||n.includes(" "+sn+" ")))seasonEvidence=Math.max(seasonEvidence,15);
      if(en&&n===en)seasonEvidence=Math.max(seasonEvidence,5);
    }
    if(identity>0)scored.push({slug:cardSlug(c),score:identity+seasonEvidence});
  }
  scored.sort((a,b)=>b.score-a.score);
  if(!scored.length)return null;
  if(scored.length>1&&scored[0].score===scored[1].score)return null;
  return scored[0].slug||null;
}

function matchMovieCard(cards,targetTitles){
  const normalizeTitle=v=>String(v||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
  const targets=[...new Set((targetTitles||[]).map(normalizeTitle).filter(Boolean))];
  const matches=[];
  for(const c of cards){
    if(cardTitles(c).some(t=>targets.includes(normalizeTitle(t))))matches.push(cardSlug(c));
  }
  const unique=[...new Set(matches.filter(Boolean))];
  return unique.length===1?unique[0]:null;
}

async function searchCards(q){
  if(!q)return[];
  const h=await text(BASE+"/anime?search="+encodeURIComponent(q)+"&sort=title-asc",{},9000);
  return h?parseCards(h):[]
}

function parseVidstack(html){
  const src=String(html||""),m=src.match(/vidstackPlayer\(JSON\.parse\('((?:[^'\\]|\\.)*)'\)\)/);
  if(m){
    const d=decodeJSON(m[1]);
    if(d&&d.src){
      const subtitles=(Array.isArray(d.subtitles)?d.subtitles:[])
        .map(s=>({
          url:String(s.file||"").replace(/\\/g,""),
          name:s.title||s.language||"English",
          language:s.language||"en"
        }))
        .filter(s=>s.url);
      return{masterUrl:String(d.src).replace(/\\/g,""),subtitles}
    }
  }
  const root=parseHTML(src);
  let masterUrl=attr(first(root,"media-player"),"src")||"";
  if(!masterUrl){
    const u=src.match(/https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*/i);
    if(u)masterUrl=u[0]
  }
  const subtitles=[];
  for(const t of all(root,"track")){
    const u=attr(t,"src")||"",kind=String(attr(t,"kind")||"").toLowerCase();
    if(u&&(kind==="subtitles"||kind==="captions"||/\.(ass|vtt)(?:\?|$)/i.test(u)))subtitles.push({
      url:u,
      name:attr(t,"label")||"English",
      language:attr(t,"srclang")||"en"
    })
  }
  return{masterUrl,subtitles}
}

function parseAudioFormat(s){
  const x=String(s||"").toLowerCase(),j=x.includes("japanese")||x.includes("jpn")||x.includes("ja"),e=x.includes("english")||x.includes("eng")||x.includes("en");
  if(e&&j)return"Dual Audio";
  if(e)return"Dub";
  if(j)return"Sub";
  if(x.includes("multi"))return"Multi-Audio";
  return"Sub"
}

async function episodePage(slug,ep){
  const r=await req(BASE+"/anime/"+slug+"/"+ep,{},10000);
  if(!r||!r.ok)return null;
  let html="";
  try{html=await r.text()}catch(e){return null}
  let cookie="";
  try{
    if(r.headers&&typeof r.headers.getSetCookie==="function")cookie=r.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
    else if(r.headers&&r.headers.get)cookie=r.headers.get("set-cookie")||""
  }catch(e){}
  return{html,cookie}
}

async function getTmdbInfo(tmdbId,mediaType,season=1,episode=1){
  const type=mediaType==="movie"?"movie":"tv";
  const url="https://api.themoviedb.org/3/"+type+"/"+encodeURIComponent(tmdbId)+"?api_key="+TMDB_API_KEY+"&language=en-US";
  const d=await json(url,{headers:{"Accept":"application/json"}},7000);
  if(!d)return null;
  let seasonData=null;
  if(type==="tv"){
    seasonData=await json("https://api.themoviedb.org/3/tv/"+encodeURIComponent(tmdbId)+"/season/"+encodeURIComponent(Number.isInteger(Number(season))&&Number(season)>=0?Number(season):1)+"?api_key="+TMDB_API_KEY+"&language=en-US",{headers:{"Accept":"application/json"}},7000);
  }
  const requestedEpisode=seasonData&&Array.isArray(seasonData.episodes)?seasonData.episodes.find(x=>Number(x.episode_number)===(Number(episode)||1)):null;
  return{
    title:d.name||d.title||d.original_name||d.original_title||"",
    originalTitle:d.original_name||d.original_title||"",
    seasonName:seasonData&&seasonData.name||"",
    episodeTitle:requestedEpisode&&requestedEpisode.name||"",
    episodeAirDate:requestedEpisode&&requestedEpisode.air_date||"",
    seasonEpisodeCount:seasonData&&Array.isArray(seasonData.episodes)?seasonData.episodes.length:0
  }
}

async function dbMapping(tmdbId,season,episode){
  tmdbId=String(tmdbId||"").trim();
  season=Number.isInteger(Number(season))&&Number(season)>=0?Number(season):1;
  episode=Number(episode)||1;
  if(!tmdbId){
    console.log("[AniZone Lazy] REFUSING EMPTY TMDB ID");
    return null
  }
  const u=MAPPING_URL+"?tmdb_id="+encodeURIComponent(tmdbId)+"&tmdbId="+encodeURIComponent(tmdbId)+"&season="+season+"&episode="+episode+"&pending=1";
  const d=await json(u,{headers:{"Accept":"application/json"}},8000);
  if(d&&d.ok&&d.mapping){
    console.log("[AniZone Lazy] DB HIT",{tmdbId,season,episode,boundary:!!(d.state&&d.state.boundary)});
    return{mapping:d.mapping,fromDb:true,state:d.state||null}
  }
  console.log("[AniZone Lazy] DB MISS",{tmdbId,season,episode,status:d&&d.status,error:d&&d.error});
  return null
}

function pollLazyMapping(tmdbId,season,episode,maxWait){
  const delays=[250,500,1000,1500,2000];
  const start=Date.now();
  return new Promise(resolve=>{
    let i=0;
    const attempt=()=>{
      if(i>=delays.length)return resolve(null);
      if(Date.now()-start>=maxWait)return resolve(null);
      const d=delays[i++];
      setTimeout(()=>{
        if(Date.now()-start>=maxWait)return resolve(null);
        const u=MAPPING_URL+"?tmdb_id="+encodeURIComponent(tmdbId)+"&tmdbId="+encodeURIComponent(tmdbId)+"&season="+season+"&episode="+episode+"&pending=1";
        json(u,{headers:{"Accept":"application/json"}},8000).then(d=>{
          if(d&&d.ok&&d.mapping)return resolve({mapping:d.mapping,fromDb:true,state:d.state||null});
          attempt()
        }).catch(()=>attempt())
      },d)
    };
    attempt()
  })
}

function mapTitle(m){
  return String(m&&(m.anime_title||m.title||m.name||m.mal_title)||"").trim()
}

function mapEp(m,fallback){
  const n=Number(m&&(m.mal_episode!=null?m.mal_episode:m.episode!=null?m.episode:m.malEpisode));
  return Number.isInteger(n)&&n>0?n:null
}

function mapTitles(m){
  const a=[];
  if(m&&Array.isArray(m.titles))a.push(...m.titles);
  const t=mapTitle(m);
  if(t)a.push(t);
  return[...new Set(a.map(x=>String(x||"").trim()).filter(Boolean))]
}

function mapMalId(m){
  const v=m&&(m.mal_id!=null?m.mal_id:m.malId!=null?m.malId:m.id);
  return v==null?"":String(v)
}

function mapImdb(m){
  return String(m&&(m.imdb_id||m.imdbId||m.imdb)||"")
}

function aniZipMappings(data){
  if(!data||typeof data!=="object")return{};
  return data.mappings&&typeof data.mappings==="object"?data.mappings:data;
}

function aniZipEpisodeList(data){
  const source=data&&data.episodes;
  if(Array.isArray(source))return source.filter(x=>x&&typeof x==="object");
  if(source&&typeof source==="object")return Object.values(source).filter(x=>x&&typeof x==="object");
  return[]
}

async function aniZipLookup(key,value){
  if(!key||value==null||String(value).trim()==="")return null;
  const u=ANIZIP_BASE+"/mappings?"+encodeURIComponent(key)+"="+encodeURIComponent(String(value));
  let data=await json(u,{headers:{"Accept":"application/json"}},6500);
  if(!data||typeof data!=="object")return null;
  let mappings=aniZipMappings(data);
  // Some API responses contain only IDs at /mappings; fetch episode metadata separately.
  if(!aniZipEpisodeList(data).length&&mappings.anilist_id){
    const episodes=await json(ANIZIP_BASE+"/episodes?anilist_id="+encodeURIComponent(String(mappings.anilist_id)),{headers:{"Accept":"application/json"}},6500);
    if(episodes&&typeof episodes==="object")data={...data,...episodes,mappings:episodes.mappings||mappings};
  }
  mappings=aniZipMappings(data);
  return{data,mappings,episodes:aniZipEpisodeList(data)}
}

function normalizedEpisodeTitle(value){
  return String(value||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")
}

function episodeTitleValues(ep){
  const out=[];
  if(ep&&ep.title&&typeof ep.title==="object")out.push(...Object.values(ep.title));
  for(const k of ["title","name","episodeTitle","episode_title"])if(ep&&typeof ep[k]==="string")out.push(ep[k]);
  return[...new Set(out.map(x=>String(x||"").trim()).filter(Boolean))]
}

function matchAniZipEpisode(episodes,tmdbInfo){
  if(!Array.isArray(episodes)||!episodes.length||!tmdbInfo)return null;
  const wanted=normalizedEpisodeTitle(tmdbInfo.episodeTitle);
  const airDate=String(tmdbInfo.episodeAirDate||"").slice(0,10);
  let matches=[];
  if(wanted){
    matches=episodes.filter(ep=>episodeTitleValues(ep).some(t=>normalizedEpisodeTitle(t)===wanted));
    if(matches.length===1)return matches[0];
    if(matches.length>1&&airDate){
      const dated=matches.filter(ep=>String(ep.airDate||ep.airdate||ep.airDateUtc||"").slice(0,10)===airDate);
      if(dated.length===1)return dated[0];
    }
  }
  if(airDate){
    matches=episodes.filter(ep=>String(ep.airDate||ep.airdate||ep.airDateUtc||"").slice(0,10)===airDate);
    if(matches.length===1)return matches[0];
    if(matches.length>1&&wanted){
      const titled=matches.filter(ep=>episodeTitleValues(ep).some(t=>normalizedEpisodeTitle(t)===wanted));
      if(titled.length===1)return titled[0];
    }
  }
  return null
}

function ordinalSeason(n){
  const x=Number(n),mod100=x%100;
  const suffix=mod100>=11&&mod100<=13?"th":x%10===1?"st":x%10===2?"nd":x%10===3?"rd":"th";
  return String(x)+suffix
}

function baseSeriesTitle(title){
  return String(title||"").trim()
    .replace(/\s*[-:]?\s*(?:season|saison)\s*\d+.*$/i,"")
    .replace(/\s*[-:]?\s*\d+(?:st|nd|rd|th)\s+season.*$/i,"")
    .replace(/\s+(?:season|saison)\s*\d+.*$/i,"")
    .trim()
}

function explicitTitleSeason(title){
  const s=String(title||"");
  let m=s.match(/(?:season|saison)\s*(\d+)/i);
  if(m)return Number(m[1]);
  m=s.match(/(\d+)(?:st|nd|rd|th)\s+season/i);
  if(m)return Number(m[1]);
  const roman=s.match(/\s(?:-|:)?\s*(II|III|IV|V|VI|VII|VIII|IX|X)\s*$/i);
  if(roman){const n={II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9,X:10}[roman[1].toUpperCase()];return n||null}
  return null
}

function seasonTitleAliases(title,season){
  const raw=String(title||"").trim(),base=baseSeriesTitle(raw)||raw;
  const n=Number(season);
  if(!base||!Number.isInteger(n)||n<1)return base?[base]:[];
  const ordinal=ordinalSeason(n);
  const roman=["","I","II","III","IV","V","VI","VII","VIII","IX","X"][n]||"";
  return[...new Set([
    base+" Season "+n,
    base+" "+ordinal+" Season",
    base+" "+roman,
    base+" Season "+n+" Part 1"
  ].filter(Boolean))]
}

function seasonTargetsFromTitles(titles,fallbackTitle,season){
  const out=[];
  for(const title of [...new Set([...(titles||[]),fallbackTitle].filter(Boolean))]){
    const explicit=explicitTitleSeason(title);
    if(explicit!=null){if(explicit===Number(season))out.push(String(title).trim());continue}
    out.push(...seasonTitleAliases(title,season));
  }
  return[...new Set(out.filter(Boolean))]
}

async function malTitleInfo(malId){
  if(!/^\d+$/.test(String(malId||"")))return null;
  const d=await json("https://api.jikan.moe/v4/anime/"+encodeURIComponent(String(malId))+"/full",{headers:{"Accept":"application/json"}},6000);
  const a=d&&d.data;
  if(!a)return null;
  const titles=[a.title,a.title_english,a.title_japanese,...(Array.isArray(a.title_synonyms)?a.title_synonyms:[])].filter(x=>typeof x==="string"&&x.trim());
  return{malId:String(malId),title:String(a.title_english||a.title||""),titles:[...new Set(titles.map(x=>x.trim()))]}
}

async function aniZipEpisodeFallback(tmdbId,season,episode,tmdbInfo,currentMapping){
  if(!tmdbInfo||!tmdbInfo.episodeTitle&&!tmdbInfo.episodeAirDate)return null;
  const tried=new Set(),lookups=[];
  const currentMal=mapMalId(currentMapping);
  if(currentMal)lookups.push(["mal_id",currentMal]);
  lookups.push(["themoviedb_id",tmdbId]);
  for(const [key,value] of lookups){
    const marker=key+":"+value;
    if(tried.has(marker))continue;
    tried.add(marker);
    const result=await aniZipLookup(key,value);
    if(!result)continue;
    let mappings=result.mappings||{};
    if(!mappings.anilist_id&&mappings.mal_id&&key!=="mal_id"){
      const byMal=await aniZipLookup("mal_id",mappings.mal_id);
      if(byMal){
        mappings={...byMal.mappings,...mappings};
        result.episodes=result.episodes.length?result.episodes:byMal.episodes;
      }
    }else if(!mappings.mal_id&&mappings.anilist_id){
      const byAniList=await aniZipLookup("anilist_id",mappings.anilist_id);
      if(byAniList){
        mappings={...byAniList.mappings,...mappings};
        result.episodes=result.episodes.length?result.episodes:byAniList.episodes;
      }
    }
    const found=matchAniZipEpisode(result.episodes,tmdbInfo);
    if(!found)continue;
    const tvdbSeason=Number(found.seasonNumber),tvdbEpisode=Number(found.episodeNumber);
    const malId=String(mappings.mal_id||currentMal||"");
    if(!Number.isInteger(tvdbSeason)||tvdbSeason<0||!Number.isInteger(tvdbEpisode)||tvdbEpisode<1)continue;
    const malInfo=await malTitleInfo(malId);
    const rawBaseTitle=String((malInfo&&malInfo.title)||tmdbInfo.title||mapTitle(currentMapping)||"").trim();
    const baseTitle=baseSeriesTitle(rawBaseTitle)||rawBaseTitle;
    const malTitles=malInfo?malInfo.titles:[];
    const seasonalTitles=seasonTargetsFromTitles(malTitles,baseTitle,tvdbSeason);
    const preferredSeasonTitle=malTitles.find(t=>explicitTitleSeason(t)===tvdbSeason)||seasonalTitles[0]||baseTitle;
    const titles=[...new Set([...malTitles,...seasonalTitles].filter(Boolean))];
    const mapping={
      mal_id:malId,
      mal_episode:tvdbEpisode,
      target_episode:tvdbEpisode,
      anime_title:preferredSeasonTitle,
      titles,
      season_name:"Season "+tvdbSeason,
      tvdb_season:tvdbSeason,
      tvdb_episode:tvdbEpisode,
      source:"anizip"
    };
    console.log("[AniZone Lazy] ANIZIP EPISODE FALLBACK",{tmdbId,tmdbSeason:season,tmdbEpisode:episode,tvdbSeason,tvdbEpisode,malId,matchBy:key});
    return{mapping,malInfo,tvdbSeason,tvdbEpisode,seasonalTitles,baseTitle};
  }
  console.log("[AniZone Lazy] ANIZIP FALLBACK MISS",{tmdbId,season,episode});
  return null
}

async function aniZipMovieTitles(tmdbId){
  const result=await aniZipLookup("themoviedb_id",tmdbId);
  if(!result)return null;
  let mappings=result.mappings||{};
  if(!mappings.mal_id&&mappings.anilist_id){
    const byAniList=await aniZipLookup("anilist_id",mappings.anilist_id);
    if(byAniList)mappings={...byAniList.mappings,...mappings};
  }
  const malId=String(mappings.mal_id||"");
  if(!/^\d+$/.test(malId))return null;
  const info=await malTitleInfo(malId);
  if(!info)return{malId,titles:[]};
  console.log("[AniZone Lazy] MOVIE MAL MAPPING",{tmdbId,malId,title:info.title});
  return info
}

function cardConflictsWithRequestedSeason(cards,slug,title,targetTitles,requestedSeason){
  const card=(cards||[]).find(c=>cardSlug(c)===slug);
  if(!card)return false;
  const expected=explicitTitleSeason(title)??(targetTitles||[]).map(explicitTitleSeason).find(n=>n!=null)??Number(requestedSeason);
  const cardSeasons=cardTitles(card).map(explicitTitleSeason).filter(n=>n!=null);
  if(cardSeasons.length)return Number.isFinite(expected)&&!cardSeasons.includes(Number(expected));
  // A generic title is not enough evidence for a later season when the request itself
  // is season-qualified. Let AniZip resolve the correct TVDB season instead of guessing.
  return Number(requestedSeason)>1&&explicitTitleSeason(title)==null&&!(targetTitles||[]).some(t=>explicitTitleSeason(t)!=null);
}

async function findAniZonePage(title,altTitles,targetTitles,season,seasonName,episodeTitle,episodeNo,movie){
  const base=cleanQuery(title);
  const queries=[...new Set([base,title,...(altTitles||[]).map(t=>String(t).split(":")[0].trim())].filter(Boolean))];
  let lastCards=[];
  for(const query of queries){
    const cards=await searchCards(query);
    if(!cards.length)continue;
    lastCards=cards;
    const slug=movie?matchMovieCard(cards,targetTitles):matchCard(cards,targetTitles,base,season,seasonName,episodeTitle);
    if(!slug)continue;
    const page=await episodePage(slug,episodeNo);
    if(page)return{cards,slug,page,base};
    // Keep looking if this candidate exists but the requested episode page is rejected.
  }
  return{cards:lastCards,slug:null,page:null,base}
}

function cleanQuery(s){
  return String(s||"").split(":")[0].replace(/season.*|\d+(?:st|nd|rd|th)\s+season|saison.*/i,"").trim()
}

async function resolveStream(tmdbId,mediaType,season,episode,settings){
  tmdbId=String(tmdbId||"").trim();
  mediaType=String(mediaType||"tv").toLowerCase();
  season=Number.isInteger(Number(season))&&Number(season)>=0?Number(season):1;
  episode=Number(episode)||1;
  if(!tmdbId){
    console.log("[AniZone Lazy] ABORT EMPTY TMDB ID");
    return[]
  }

  console.log("[AniZone Lazy] REQUEST",{tmdbId,mediaType,season,episode});

  const movie=mediaType==="movie";
  let mappingResult=null,title="",altTitles=[],targetTitles=[],malEpisode=movie?1:episode,imdbId="",malId="",seasonName="";
  let tmdbInfo=null,anizipFallbackData=null,movieMalInfo=null;

  if(!movie){
    mappingResult=await dbMapping(tmdbId,season,episode);
    if(!mappingResult||!mappingResult.mapping){
      // First try AniZip as an AniZone-only fallback. It matches the requested TMDB
      // episode by title/air date, then uses AniZip's TVDB season/episode coordinates.
      tmdbInfo=await getTmdbInfo(tmdbId,"tv",season,episode);
      anizipFallbackData=await aniZipEpisodeFallback(tmdbId,season,episode,tmdbInfo,null);
      if(anizipFallbackData){
        mappingResult={mapping:anizipFallbackData.mapping,fromDb:false,anizip:true};
      }else{
        const autoPopulate=! ["false","0","disabled","off"].includes(String(getSetting(settings,["autoPopulateMissingMappings","auto_populate_missing_mappings","autoPopulate","autoPopulateMappings"],"enabled")).toLowerCase());
        if(!autoPopulate){
          console.log("[AniZone Lazy] AUTO POPULATION DISABLED — READ ONLY; ANIZIP FALLBACK MISSED");
          return[]
        }
        const triggerUrl=MAPPING_URL+"?tmdb_id="+encodeURIComponent(tmdbId)+"&tmdbId="+encodeURIComponent(tmdbId)+"&season="+season+"&episode="+episode+"&populate=1&trigger=anizone-lazy";
        const triggered=await json(triggerUrl,{headers:{"Accept":"application/json"}},8000);
        if(triggered&&triggered.ok&&triggered.mapping)mappingResult={mapping:triggered.mapping,fromDb:true,state:triggered.state||null};
        else {
          const polled=await pollLazyMapping(tmdbId,season,episode,8000);
          if(polled&&polled.mapping){console.log("[AniZone Lazy] POLL SUCCESS");mappingResult=polled}
          else {
            console.log("[AniZone Lazy] POPULATION PENDING OR UNAVAILABLE; TRYING ANIZIP AGAIN");
            anizipFallbackData=await aniZipEpisodeFallback(tmdbId,season,episode,tmdbInfo,null);
            if(anizipFallbackData)mappingResult={mapping:anizipFallbackData.mapping,fromDb:false,anizip:true};
            else {console.log("[AniZone Lazy] NO SHINKRO OR ANIZIP MAPPING");return[]}
          }
        }
      }
    }

    const m=mappingResult.mapping;
    title=mapTitle(m);
    targetTitles=mapTitles(m);
    malEpisode=mapEp(m,episode);
    if(!malEpisode){console.log("[AniZone Lazy] MAPPING HAS NO VALID PROVIDER EPISODE",{tmdbId,season,episode});return[]}
    imdbId=mapImdb(m);
    malId=mapMalId(m);
    seasonName=String(m.season_name||m.seasonName||"");
    if(anizipFallbackData){
      title=anizipFallbackData.mapping.anime_title||title;
      targetTitles=anizipFallbackData.seasonalTitles;
      malEpisode=anizipFallbackData.tvdbEpisode;
      seasonName="Season "+anizipFallbackData.tvdbSeason;
      console.log("[AniZone Lazy] USING ANIZIP TVDB COORDINATES",{tvdbSeason:anizipFallbackData.tvdbSeason,tvdbEpisode:anizipFallbackData.tvdbEpisode});
    }
  }else{
    const info=await getTmdbInfo(tmdbId,"movie");
    if(!info||!info.title){
      console.log("[AniZone Lazy] MOVIE TMDB LOOKUP FAILED",tmdbId);
      return[]
    }
    title=info.title;
    if(info.originalTitle&&normalize(info.originalTitle)!==normalize(title))altTitles.push(info.originalTitle);
    // Movie-only MAL lookup: enrich the exact movie title search; never use this for TV.
    movieMalInfo=await aniZipMovieTitles(tmdbId);
    if(movieMalInfo&&Array.isArray(movieMalInfo.titles))altTitles.push(...movieMalInfo.titles);
  }

  if(!tmdbInfo&&!movie)tmdbInfo=await getTmdbInfo(tmdbId,"tv",season,episode);
  if(tmdbInfo){
    if(tmdbInfo.title&&!title)title=tmdbInfo.title;
    if(tmdbInfo.originalTitle&&normalize(tmdbInfo.originalTitle)!==normalize(title))altTitles.push(tmdbInfo.originalTitle);
    seasonName=seasonName||tmdbInfo.seasonName||""
  }

  let specific=[...new Set([...targetTitles,title,...altTitles].filter(Boolean))];
  let base=cleanQuery(title);
  let pageResult=await findAniZonePage(
    title,
    altTitles,
    anizipFallbackData?anizipFallbackData.seasonalTitles:specific,
    anizipFallbackData?anizipFallbackData.tvdbSeason:season,
    seasonName,
    tmdbInfo&&tmdbInfo.episodeTitle||"",
    malEpisode,
    movie
  );
  let cards=pageResult.cards,slug=pageResult.slug,page=pageResult.page;
  if(!movie&&!anizipFallbackData&&slug&&cardConflictsWithRequestedSeason(cards,slug,title,specific,season)){
    console.log("[AniZone Lazy] SEASON IDENTITY REJECTED; TRYING ANIZIP",{title,season,slug});
    slug=null;page=null;
  }

  // If Shinkro found an entry but AniZone does not have that season/episode page,
  // resolve the requested TMDB episode against AniZip and retry once with TVDB coords.
  if(!movie&&(!slug||!page)&&!anizipFallbackData){
    const fallback=await aniZipEpisodeFallback(tmdbId,season,episode,tmdbInfo,mappingResult&&mappingResult.mapping);
    if(fallback){
      anizipFallbackData=fallback;
      title=fallback.mapping.anime_title||title;
      targetTitles=fallback.seasonalTitles;
      malEpisode=fallback.tvdbEpisode;
      seasonName="Season "+fallback.tvdbSeason;
      specific=fallback.seasonalTitles;
      base=cleanQuery(fallback.baseTitle||title);
      pageResult=await findAniZonePage(
        title,
        [...new Set([fallback.baseTitle,...altTitles].filter(Boolean))],
        fallback.seasonalTitles,
        fallback.tvdbSeason,
        seasonName,
        tmdbInfo&&tmdbInfo.episodeTitle||"",
        malEpisode,
        false
      );
      cards=pageResult.cards;slug=pageResult.slug;page=pageResult.page;
    }
  }

  if(!cards.length){
    console.log("[AniZone Lazy] SEARCH EMPTY",title);
    return[]
  }
  if(!slug){
    console.log("[AniZone Lazy] CARD NOT FOUND",{title,season,results:cards.length,anizip:!!anizipFallbackData});
    return[]
  }
  console.log("[AniZone Lazy] CARD MATCH",{title,slug,episode:malEpisode,source:anizipFallbackData?"anizip":"primary"});
  if(!page){
    console.log("[AniZone Lazy] EPISODE PAGE FAILED",{slug,episode:malEpisode,anizip:!!anizipFallbackData});
    return[]
  }

  const root=parseHTML(page.html);
  const parsed=parseVidstack(page.html);
  const streams=[];
  const seen=new Set();

  const buttons=all(root,"button").filter(b=>String(attr(b,"wire:click")||"").includes("setVideo"));

  let defaultFormat="Sub",defaultServerName="AniZone";

  if(buttons.length){
    const label=nodeText(buttons[0]).replace(/\s+/g," ").trim();
    defaultFormat=parseAudioFormat(label);
    const nm=label.match(/^([A-Za-z0-9_-]+)/);
    if(nm)defaultServerName=nm[1]
  }

  if(parsed.masterUrl){
    seen.add(parsed.masterUrl);
    streams.push({
      name:"AniZone",
      title:title+" - Episode "+malEpisode+" ["+defaultServerName+" - "+defaultFormat+"]",
      url:parsed.masterUrl,
      quality:"Multi",
      headers:HEADERS,
      subtitles:parsed.subtitles||[]
    })
  }

  if(buttons.length>1){
    const csrf=String(
      attr(first(root,"script[data-csrf]"),"data-csrf")||
      attr(first(root,'meta[name="csrf-token"]'),"content")||
      ""
    );
    const snapshot=attr(first(root,"[wire:snapshot]"),"wire:snapshot")||"";
    const componentId=attr(first(root,"[wire:id]"),"wire:id")||"";

    if(csrf&&snapshot&&page.cookie){
      const jobs=[];

      for(let i=1;i<buttons.length;i++){
        const btn=buttons[i];
        const vm=String(attr(btn,"wire:click")||"").match(/setVideo\((\d+)\)/);
        if(!vm)continue;

        const videoId=Number(vm[1]);
        const label=nodeText(btn).replace(/\s+/g," ").trim();
        const format=parseAudioFormat(label);
        const nm=label.match(/^([A-Za-z0-9_-]+)/);
        const serverName=nm?nm[1]:"Server "+(i+1);

        jobs.push((async()=>{
          try{
            const body={
              _token:csrf,
              components:[{
                snapshot,
                updates:{},
                calls:[{
                  path:"",
                  method:"setVideo",
                  params:[videoId]
                }]
              }]
            };

            const r=await req(BASE+"/livewire/update",{
              method:"POST",
              headers:{
                "Accept":"*/*",
                "Content-Type":"application/json",
                "X-Livewire":"",
                "X-CSRF-TOKEN":csrf,
                "Origin":BASE,
                "Referer":BASE+"/anime/"+slug+"/"+malEpisode,
                "Cookie":page.cookie,
                ...(componentId?{"X-Livewire-Id":componentId}:{})
              },
              body:JSON.stringify(body)
            },8000);

            if(!r||!r.ok)return null;

            let raw="";
            try{raw=await r.text()}catch(e){return null}

            let data=null;
            try{data=JSON.parse(raw)}catch(e){}

            let html="";
            if(data&&data.components&&data.components[0]&&data.components[0].effects){
              html=data.components[0].effects.html||""
            }
            if(!html)html=raw;
            if(!html)return null;

            const p=parseVidstack(html);
            if(!p.masterUrl||seen.has(p.masterUrl))return null;

            return{
              url:p.masterUrl,
              stream:{
                name:"AniZone",
                title:title+" - Episode "+malEpisode+" ["+serverName+" - "+format+"]",
                url:p.masterUrl,
                quality:"Multi",
                headers:HEADERS,
                subtitles:p.subtitles&&p.subtitles.length?p.subtitles:parsed.subtitles||[]
              }
            }
          }catch(e){
            console.log("[AniZone Lazy] LIVEWIRE SERVER FAILED",videoId,String(e));
            return null
          }
        })())
      }

      const extra=await Promise.all(jobs);

      for(const x of extra){
        if(x&&x.stream&&!seen.has(x.url)){
          seen.add(x.url);
          streams.push(x.stream)
        }
      }
    }
  }

  console.log("[AniZone Lazy] STREAMS FOUND",{title,slug,episode:malEpisode,count:streams.length});
  return streams
}

function getSetting(settings,names,fallback){
  if(!settings||typeof settings!=="object")return fallback;
  for(const n of names)if(Object.prototype.hasOwnProperty.call(settings,n)&&settings[n]!==undefined&&settings[n]!==null)return settings[n];
  return fallback
}
function onSettings(){
  return [{type:"select",key:"autoPopulateMissingMappings",name:"autoPopulateMissingMappings",label:"Auto-populate missing mappings",options:[{label:"Enabled",value:"enabled"},{label:"Disabled",value:"disabled"}],default:"enabled"}]
}
async function getStreams(tmdbId,mediaType,season,episode,settings={}){
  try{
    return await resolveStream(
      String(tmdbId||""),
      String(mediaType||"tv"),
      Number.isInteger(Number(season))&&Number(season)>=0?Number(season):1,
      Number(episode)||1,
      settings
    )
  }catch(e){
    console.log("[AniZone Lazy] ERROR",String(e));
    return[]
  }
}

module.exports={getStreams,onSettings};
