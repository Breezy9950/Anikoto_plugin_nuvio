const cheerio=require("cheerio-without-node-native");
const CryptoJS=require("crypto-js");

const ANIKOTO_URL="https://anikototv.to";
const AJAX_URL=`${ANIKOTO_URL}/ajax`;
const MAPPER_URL="https://mapper.nekostream.site";
const ANIBRIDGE_URL="https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json";
const ANILIST_URL="https://graphql.anilist.co";
const ANIBRIDGE_CHUNK_SIZE=900000;
const ANIBRIDGE_CACHE_TTL=86400000;
let ANIBRIDGE_DATA=null,ANIBRIDGE_LOADED=0;
const USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const ANIKOTO_HEADERS={
  "Referer":`${ANIKOTO_URL}/`,
  "X-Requested-With":"XMLHttpRequest"
};
const DEFAULT_TIMEOUT=10000;

function log(message){console.log(`[AniKoto-AniBridge] ${message}`);}

async function fetchWithTimeout(url,options={},timeout=DEFAULT_TIMEOUT){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{return await fetch(url,{...options,signal:controller.signal});}
  finally{clearTimeout(timer);}
}

async function getText(url,options={},timeout=DEFAULT_TIMEOUT){
  try{
    const res=await fetchWithTimeout(url,options,timeout);
    if(!res.ok){log(`HTTP ${res.status} ${url}`);return null;}
    return await res.text();
  }catch(error){
    log(`GET failed ${url}: ${error.message}`);
    return null;
  }
}

async function getJson(url,options={},timeout=DEFAULT_TIMEOUT){
  try{
    const res=await fetchWithTimeout(url,options,timeout);
    if(!res.ok){
      log(`HTTP ${res.status} ${url}`);
      return null;
    }
    return await res.json();
  }catch(error){
    log(`JSON request failed ${url}: ${error.message}`);
    return null;
  }
}

function cleanEmbeddedJson(raw){
  return String(raw||"").replace(/\\u0022/g,'"');
}

function normalizeTitle(value){
  return String(value||"")
    .toLowerCase()
    .replace(/&/g,"and")
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}

function unique(values){
  return [...new Set(values.filter(Boolean).map(String))];
}

function parsePositiveInt(value){
  const n=Number(value);
  return Number.isInteger(n)&&n>0?n:null;
}

async function loadAniBridge(){
  if(ANIBRIDGE_DATA&&Date.now()-ANIBRIDGE_LOADED<ANIBRIDGE_CACHE_TTL)return ANIBRIDGE_DATA;
  const parts=[];
  let start=0,total=null;
  log("Loading AniBridge mappings from GitHub in chunks");
  while(total===null||start<total){
    const end=start+ANIBRIDGE_CHUNK_SIZE-1;
    try{
      const res=await fetchWithTimeout(ANIBRIDGE_URL,{
        headers:{
          "Accept":"application/json",
          "User-Agent":USER_AGENT,
          "Range":`bytes=${start}-${end}`
        }
      },30000);
      if(!res.ok)throw new Error(`HTTP ${res.status}`);
      const range=res.headers?.get("content-range")||res.headers?.get("Content-Range")||"";
      const match=range.match(/bytes\s+(\d+)-(\d+)\/(\d+)/i);
      if(!match)throw new Error("GitHub did not return Content-Range for Range request");
      const rangeStart=Number(match[1]);
      const rangeEnd=Number(match[2]);
      const rangeTotal=Number(match[3]);
      if(rangeStart!==start)throw new Error(`Unexpected range start ${rangeStart}, expected ${start}`);
      total=rangeTotal;
      const part=await res.text();
      if(!part)throw new Error("Empty AniBridge chunk");
      parts.push(part);
      start=rangeEnd+1;
      log(`AniBridge chunk ${rangeStart}-${rangeEnd}/${total}`);
      if(part.length!==rangeEnd-rangeStart+1&&start<total){
        log(`AniBridge UTF/text length differs from byte range: ${part.length}/${rangeEnd-rangeStart+1}`);
      }
    }catch(error){
      log(`AniBridge chunk load failed at ${start}: ${error.message}`);
      throw error;
    }
  }
  const text=parts.join("");
  log(`AniBridge download complete: ${text.length} chars`);
  ANIBRIDGE_DATA=JSON.parse(text);
  ANIBRIDGE_LOADED=Date.now();
  return ANIBRIDGE_DATA;
}

function parseRangePart(value){
  const s=String(value||"").trim();
  if(!s)return null;
  const m=s.match(/^(\d+)(?:-(\d+))?$/);
  if(!m)return null;
  return{start:Number(m[1]),end:Number(m[2]||m[1])};
}

function resolveMappedEpisode(table,episode){
  if(!table||typeof table!=="object")return null;
  const wanted=Number(episode);
  for(const sourceRange of Object.keys(table)){
    const sourceParts=String(sourceRange).split(",").map(parseRangePart).filter(Boolean);
    for(const source of sourceParts){
      if(wanted<source.start||wanted>source.end)continue;
      const targetRaw=table[sourceRange];
      const targetParts=String(targetRaw??"").split(",").map(parseRangePart).filter(Boolean);
      if(!targetParts.length)continue;
      const offset=wanted-source.start;
      let count=0;
      for(const target of targetParts){
        const length=target.end-target.start+1;
        if(offset<count+length)return target.start+(offset-count);
        count+=length;
      }
    }
  }
  return null;
}

async function getAniListMeta(id){
  try{
    const body=await getJson(ANILIST_URL,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Accept":"application/json",
        "User-Agent":USER_AGENT
      },
      body:JSON.stringify({
        query:"query($id:Int){Media(id:$id,type:ANIME){id,idMal,title{romaji,english,native}}}",
        variables:{id:Number(id)}
      })
    },10000);
    const media=body?.data?.Media;
    if(!media)return null;
    return{
      malId:media.idMal?String(media.idMal):null,
      title:String(media.title?.english||media.title?.romaji||media.title?.native||"").trim(),
      titles:[media.title?.english,media.title?.romaji,media.title?.native].filter(Boolean).map(String)
    };
  }catch(error){
    log(`AniList metadata failed: ${error.message}`);
    return null;
  }
}

async function getMapping(tmdbId,season,episode){
  log(`AniBridge mapping TMDB=${tmdbId} S${season}E${episode}`);
  try{
    const data=await loadAniBridge();
    const key=`tmdb_show:${tmdbId}:s${season}`;
    const source=data?.[key];
    if(!source){
      log(`AniBridge source not found: ${key}`);
      return null;
    }

    let malId=null,malEpisode=null,anilistId=null;

    for(const descriptor of Object.keys(source)){
      const lower=descriptor.toLowerCase();
      const target=source[descriptor];

      if(lower.startsWith("mal:")){
        const id=descriptor.split(":")[1];
        const mapped=resolveMappedEpisode(target,episode);
        if(id&&mapped!==null){
          malId=String(id);
          malEpisode=mapped;
          break;
        }
      }
    }

    if(!malId){
      for(const descriptor of Object.keys(source)){
        const lower=descriptor.toLowerCase();
        if(!lower.startsWith("anilist:"))continue;

        const id=descriptor.split(":")[1];
        const mapped=resolveMappedEpisode(source[descriptor],episode);

        if(id&&mapped!==null){
          anilistId=String(id);
          const meta=await getAniListMeta(anilistId);

          if(meta?.malId){
            malId=meta.malId;
            malEpisode=mapped;
            return{
              malId,
              malEpisode,
              title:meta.title,
              titles:meta.titles
            };
          }
        }
      }
    }

    if(!malId){
      log(`AniBridge no MAL mapping for ${key} E${episode}`);
      return null;
    }

    let title="",titles=[];

    if(anilistId){
      const meta=await getAniListMeta(anilistId);
      if(meta){
        title=meta.title||"";
        titles=meta.titles||[];
      }
    }else{
      for(const descriptor of Object.keys(source)){
        if(!descriptor.toLowerCase().startsWith("anilist:"))continue;

        const id=descriptor.split(":")[1];
        const mapped=resolveMappedEpisode(source[descriptor],episode);

        if(id&&mapped!==null){
          const meta=await getAniListMeta(id);
          if(meta){
            title=meta.title||"";
            titles=meta.titles||[];
          }
          break;
        }
      }
    }

    if(!title)title=String(tmdbId);

    log(`AniBridge hit TMDB=${tmdbId} S${season}E${episode} -> MAL=${malId} E${malEpisode}`);

    return{
      malId,
      malEpisode,
      title,
      titles
    };
  }catch(error){
    log(`AniBridge mapping failed: ${error.message}`);
    return null;
  }
}

async function searchAnime(query){
  if(!query)return[];
  const url=`${AJAX_URL}/anime/search?keyword=${encodeURIComponent(query)}`;
  const body=await getJson(url,{"headers":ANIKOTO_HEADERS},10000);
  const html=body?.result?.html;
  if(!html){
    log(`Search returned no HTML for "${query}"`);
    return[];
  }
  const $=cheerio.load(html);
  const results=[];
  $("div.scaff.items").children().each((_,item)=>{
    const el=$(item);
    const title=el.find(".name.d-title").first().text().trim();
    const href=el.attr("href");
    const image=el.find("img").first().attr("src")||"";
    if(title&&href){
      results.push({
        title,
        url:new URL(href,ANIKOTO_URL).href,
        image
      });
    }
  });
  log(`Search "${query}" -> ${results.length} results`);
  return results;
}

function rankSearchResults(results,titles){
  const targets=unique(titles).map(normalizeTitle).filter(Boolean);
  return[...results].sort((a,b)=>{
    const score=item=>{
      const t=normalizeTitle(item.title);
      if(targets.includes(t))return 100;
      if(targets.some(x=>t.includes(x)||x.includes(t)))return 80;
      return 0;
    };
    return score(b)-score(a);
  });
}

async function getEpisodeList(animeUrl){
  const page=await getText(animeUrl,{"headers":ANIKOTO_HEADERS},10000);
  if(!page)return null;
  const $=cheerio.load(page);
  const watchId=$("#watch-main").attr("data-id")?.trim();
  if(!watchId){
    log(`No watch-main data-id for ${animeUrl}`);
    return null;
  }
  const episodeUrl=`${AJAX_URL}/episode/list/${encodeURIComponent(watchId)}?vrf=`;
  const data=await getJson(episodeUrl,{"headers":ANIKOTO_HEADERS},10000);
  const html=data?.result;
  if(!html)return null;
  const doc=cheerio.load(html);
  const episodes=[];
  doc("div.episodes a").each((_,a)=>{
    const el=doc(a);
    const episodeId=el.attr("data-ids")?.trim();
    const href=el.attr("href")?new URL(el.attr("href"),ANIKOTO_URL).href:null;
    const malId=el.attr("data-mal")?.trim();
    const number=parsePositiveInt(el.attr("data-num"));
    if(!number)return;
    episodes.push({
      episodeId,
      href,
      malId:malId||null,
      episodeNumber:number,
      title:el.attr("title")?.trim()||"",
      dub:el.attr("data-dub")==="1",
      filler:String(el.attr("class")||"").split(/\s+/).includes("filler")
    });
  });
  log(`Episode list parsed: ${episodes.length}`);
  return episodes;
}

async function findAnimeEpisode(mapping){
  const queries=unique([mapping.title,...mapping.titles]);
  const all=[];
  for(const query of queries){
    const results=await searchAnime(query);
    all.push(...results);
    if(all.length>=30)break;
  }

  const candidates=rankSearchResults(
    uniqueObjects(all,r=>r.url),
    queries
  );

  for(const candidate of candidates.slice(0,10)){
    log(`Checking candidate "${candidate.title}"`);
    const episodes=await getEpisodeList(candidate.url);
    if(!episodes?.length){
      log(`No episodes for candidate "${candidate.title}"`);
      continue;
    }

    const exact=episodes.find(ep=>ep.malId===mapping.malId&&ep.episodeNumber===mapping.malEpisode);

    if(!exact)log(`No exact MAL=${mapping.malId} E${mapping.malEpisode} match in ${episodes.length} episodes`);

    if(exact?.episodeId){
      log(`Matched "${candidate.title}" MAL=${mapping.malId} E${mapping.malEpisode}`);
      return{
        candidate,
        episode:exact,
        episodes
      };
    }
  }

  return null;
}

function uniqueObjects(items,keyFn){
  const seen=new Set();
  const out=[];
  for(const item of items){
    const key=keyFn(item);
    if(!key||seen.has(key))continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function getKiwiStreamId(malId,episode){
  const timestamp=Math.floor(Date.now()/1000);
  const url=`${MAPPER_URL}/api/mal/${encodeURIComponent(malId)}/${encodeURIComponent(episode)}/${timestamp}`;
  const data=await getJson(url,{"headers":ANIKOTO_HEADERS},10000);
  return data?.["Kiwi-Stream-"]||null;
}

async function getServerLinks(episodeId,dub){
  const url=`${AJAX_URL}/server/list?servers=${encodeURIComponent(episodeId)}`;
  const body=await getJson(url,{"headers":ANIKOTO_HEADERS},10000);
  const html=body?.result;
  if(!html)return[];
  const $=cheerio.load(html);
  const servers=[];

  $("div.servers").each((_,group)=>{
    const groupName=$(group).contents().first().text().trim();

    $("div.type",group).each((_,type)=>{
      const isDub=$(type).attr("data-type")==="dub";
      if(isDub!==dub)return;

      $("ul",type).first().children().each((_,item)=>{
        const el=$(item);
        const linkId=el.attr("data-link-id")?.trim();

        if(linkId){
          servers.push({
            name:el.text().trim()||"Unknown",
            linkId,
            groupName
          });
        }
      });
    });
  });

  return servers;
}

async function getServerUrl(linkId){
  const url=`${AJAX_URL}/server?get=${encodeURIComponent(linkId)}`;
  const body=await getJson(url,{"headers":ANIKOTO_HEADERS},10000);
  return body?.result?.url?String(body.result.url).trim():null;
}

function base64UrlToWordArray(value){
  const s=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
  return CryptoJS.enc.Base64.parse(s.padEnd(Math.ceil(s.length/4)*4,"="));
}

function utf8ZeroPaddedKey(value,length){
  const bytes=CryptoJS.enc.Utf8.parse(String(value||""));
  const words=CryptoJS.lib.WordArray.create();
  words.concat(bytes);
  while(words.sigBytes<length)words.concat(CryptoJS.lib.WordArray.create([0],4));
  words.sigBytes=length;
  return words;
}

function wordArrayBase64Url(value){
  return CryptoJS.enc.Base64.stringify(value).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}

function sourceFile(response){
  const encrypted=response?.enc;

  if(typeof encrypted==="string"&&encrypted){
    try{
      const key=utf8ZeroPaddedKey("i?LMTAx0Q6,:}50U",32);
      const iv=CryptoJS.enc.Utf8.parse("W0;27ToaUpl_P%'c");
      const cipherParams=CryptoJS.lib.CipherParams.create({
        ciphertext:base64UrlToWordArray(encrypted)
      });
      const plaintext=CryptoJS.AES.decrypt(
        cipherParams,
        key,
        {
          iv,
          mode:CryptoJS.mode.CBC,
          padding:CryptoJS.pad.Pkcs7
        }
      ).toString(CryptoJS.enc.Utf8);

      const decoded=JSON.parse(plaintext);

      if(typeof decoded?.file==="string"&&decoded.file)return decoded.file;
    }catch(error){
      log(`Megaplay encrypted source decode failed: ${error.message}`);
    }
  }

  if(
    response?.sources&&
    typeof response.sources==="object"&&
    !Array.isArray(response.sources)&&
    typeof response.sources.file==="string"
  )return response.sources.file;

  if(
    Array.isArray(response?.sources)&&
    response.sources.length&&
    typeof response.sources[0]?.file==="string"
  )return response.sources[0].file;

  return null;
}

function signMegaplayUrl(fileUrl){
  try{
    const uri=new URL(fileUrl);
    const match=uri.pathname.match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
    if(!match)return fileUrl;

    const expires=Math.floor(Date.now()/1000)+90;
    const payload=CryptoJS.enc.Utf8.parse(
      `${expires}|${match[1].toLowerCase()}/${match[2].toLowerCase()}`
    );
    const signature=CryptoJS.HmacSHA256(
      payload,
      "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s"
    );

    uri.searchParams.set(
      "token",
      `${wordArrayBase64Url(payload)}.${wordArrayBase64Url(signature)}`
    );

    return uri.toString();
  }catch(_){
    return fileUrl;
  }
}

function subtitleFormat(url,declared){
  const allowed=new Set(["srt","vtt","ass"]);
  const fromDeclared=String(declared||"").toLowerCase().replace(/^./,"");

  if(allowed.has(fromDeclared))return fromDeclared;

  try{
    const pathname=new URL(url).pathname;
    const ext=pathname.split(".").pop()?.toLowerCase();
    return allowed.has(ext)?ext:"vtt";
  }catch(_){
    return "vtt";
  }
}

function cleanUrl(value){
  return typeof value==="string"?value.replace(/\\/g,""):value;
}

async function extractVidtube(url,server){
  const page=await getText(url,{},10000);
  if(!page)return[];

  const $=cheerio.load(page);
  const id=$("#megaplay-player").attr("data-id");
  if(!id)return[];

  const type=new URL(url).pathname.split("/").filter(Boolean).pop();
  if(!type)return[];

  const sourceUrl=new URL("https://vidtube.site/stream/getSourcesNew");
  sourceUrl.searchParams.set("id",id);
  sourceUrl.searchParams.set("type",type);

  const response=await getJson(sourceUrl.href,{
    "headers":{
      "X-Requested-With":"XMLHttpRequest"
    }
  },10000);

  const playlist=response?.sources?.file;
  if(!playlist)return[];

  const tracks=Array.isArray(response?.tracks)?response.tracks:[];

  let sub=tracks.find(
    t=>t&&t.kind==="captions"&&String(t.lang||"").toLowerCase()==="english"
  )?.file;

  if(!sub)sub=tracks.find(
    t=>t&&t.kind==="captions"&&t.default===true
  )?.file;

  sub=cleanUrl(sub);

  return[{
    name:server||"vidtube",
    title:`${server||"vidtube"} [multi-quality]`,
    url:cleanUrl(playlist),
    quality:"multi-quality",
    headers:{
      "Referer":"https://vidtube.site/",
      "Origin":"https://vidtube.site"
    },
    subtitle:sub||"",
    subtitleFormat:sub?"vtt":"",
    subtitles:sub?[{
      url:sub,
      name:"English",
      language:"en",
      format:"vtt",
      default:true
    }]:[],
    backup:false
  }];
}

async function extractMegaplay(url,server){
  const page=await getText(url,{"headers":ANIKOTO_HEADERS},10000);
  if(!page)return[];

  const $=cheerio.load(page);
  const mediaId=$("#megaplay-player").attr("data-id");
  if(!mediaId)return[];

  const pageUrl=new URL(url);
  let sourceResponse=null;
  let streamUrl=null;

  for(const endpoint of ["getSources","getSourcesNew"]){
    try{
      const sourceUrl=new URL(`/stream/${endpoint}`,pageUrl.origin);
      sourceUrl.searchParams.set("id",mediaId);

      const section=pageUrl.searchParams.get("s");
      if(section)sourceUrl.searchParams.set("s",section);

      const response=await getJson(sourceUrl.href,{
        "headers":{
          "X-Requested-With":"XMLHttpRequest",
          "Referer":url
        }
      },10000);

      const file=sourceFile(response);

      if(file){
        sourceResponse=response;
        streamUrl=cleanUrl(file);
        break;
      }
    }catch(error){
      log(`Megaplay ${endpoint} failed: ${error.message}`);
    }
  }

  if(!streamUrl||!sourceResponse)return[];

  const tracks=Array.isArray(sourceResponse.tracks)?sourceResponse.tracks:[];

  const english=
    tracks.find(
      t=>t&&t.kind==="captions"&&String(t.label||"").toLowerCase()==="english"
    )||
    tracks.find(
      t=>t&&t.kind==="captions"&&t.default===true
    );

  const sub=cleanUrl(english?.file);
  const signed=signMegaplayUrl(streamUrl);

  return[{
    name:server||"Megaplay",
    title:`${server||"Megaplay"} [multi-quality]`,
    url:signed,
    quality:"multi-quality",
    headers:{
      "Referer":"https://megaplay.buzz/",
      "Origin":"https://megaplay.buzz"
    },
    subtitle:sub||"",
    subtitleFormat:sub?subtitleFormat(sub,english?.format):"",
    subtitles:sub?[{
      url:sub,
      name:"English",
      language:"en",
      format:subtitleFormat(sub,english?.format),
      default:true
    }]:[],
    backup:false
  }];
}

async function extractStream(streamUrl,server){
  try{
    const host=new URL(streamUrl).hostname.toLowerCase().split(".")[0];

    if(host==="vidtube")return await extractVidtube(streamUrl,server);
    if(host==="megaplay")return await extractMegaplay(streamUrl,server);

    log(`Unsupported extractor host: ${host}`);
    return[];
  }catch(error){
    log(`Extractor failed for ${server||"unknown"}: ${error.message}`);
    return[];
  }
}

async function fetchStreamsForEpisode(episodeId,malId,malEpisode,dub){
  const servers=await getServerLinks(episodeId,dub);
  log(`Server list: ${servers.length} servers for episode ${episodeId}`);

  if(!servers.length)return[];

  const kiwiPromise=getKiwiStreamId(malId,malEpisode).catch(error=>{
    log(`Kiwi mapper failed: ${error.message}`);
    return null;
  });

  const kiwi=await kiwiPromise;

  if(kiwi?.sub?.url){
    servers.push({
      name:"Kiwi",
      linkId:String(kiwi.sub.url),
      groupName:"Kiwi"
    });
  }

  const streams=[];

  for(const server of servers){
    try{
      const streamUrl=await getServerUrl(server.linkId);

      if(!streamUrl){
        log(`No stream URL for server ${server.name}`);
        continue;
      }

      log(`Server ${server.name} -> ${streamUrl}`);

      const extracted=await extractStream(streamUrl,server.name);

      log(`Extractor ${server.name} -> ${extracted.length} streams`);

      if(extracted.length)streams.push(...extracted);
    }catch(error){
      log(`Server ${server.name} failed: ${error.message}`);
    }
  }

  return streams;
}

async function getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){
  try{
    const id=String(tmdbId||"").trim();
    const seasonNum=parsePositiveInt(season)||1;
    const episodeNum=parsePositiveInt(episode)||1;

    if(!id)return[];

    if(String(mediaType).toLowerCase()!=="tv"){
      log("AniKoto provider requires a TV/anime mapping");
      return[];
    }

    const mapping=await getMapping(id,seasonNum,episodeNum);

    if(!mapping){
      log(`No MAL mapping for TMDB=${id} S${seasonNum}E${episodeNum}`);
      return[];
    }

    log(`TMDB=${id} S${seasonNum}E${episodeNum} -> MAL=${mapping.malId} E${mapping.malEpisode}`);

    const match=await findAnimeEpisode(mapping);

    if(!match){
      log(`AniKoto episode not found for MAL=${mapping.malId} E${mapping.malEpisode}`);
      return[];
    }

    const dub=typeof settings==="boolean"?settings:!!settings?.dub;

    const streams=await fetchStreamsForEpisode(
      match.episode.episodeId,
      mapping.malId,
      mapping.malEpisode,
      dub
    );

    log(`Streams found: ${streams.length}`);

    return streams;
  }catch(error){
    log(`Fatal: ${error.message}`);
    return[];
  }
}

module.exports={getStreams};
