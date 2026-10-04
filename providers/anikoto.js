const cheerio=require("cheerio-without-node-native");
const crypto=require("crypto");

const ANIKOTO_URL="https://anikototv.to";
const AJAX_URL=`${ANIKOTO_URL}/ajax`;
const MAPPER_URL="https://mapper.nekostream.site";
const MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-mapping";
const HEADERS={
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer":`${ANIKOTO_URL}/`,
  "X-Requested-With":"XMLHttpRequest"
};
const DEFAULT_TIMEOUT=10000;

function log(message){console.log(`[AniKoto] ${message}`);}

async function fetchWithTimeout(url,options={},timeout=DEFAULT_TIMEOUT){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const headers={...HEADERS,...(options.headers||{})};
    return await fetch(url,{...options,headers,signal:controller.signal});
  }finally{clearTimeout(timer);}
}

async function getText(url,options={},timeout=DEFAULT_TIMEOUT){
  try{
    const res=await fetchWithTimeout(url,options,timeout);
    if(!res.ok)return null;
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

async function getMapping(tmdbId,season,episode){
  const url=`${MAPPING_URL}?tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`;
  log(`Mapping TMDB=${tmdbId} S${season}E${episode}`);
  const body=await getJson(url,{"headers":{"Accept":"application/json","User-Agent":HEADERS["User-Agent"],"Referer":`${ANIKOTO_URL}/`}},6000);
  if(!body?.ok||!body.mapping)return null;
  const mapping=body.mapping;
  const malId=String(mapping.mal_id||mapping.malId||"").trim();
  const malEpisode=parsePositiveInt(mapping.mal_episode||mapping.target_episode);
  if(!malId||!malEpisode){
    log("Mapping response did not contain a valid MAL id/episode");
    return null;
  }
  return{
    malId,
    malEpisode,
    title:String(mapping.anime_title||"").trim(),
    titles:Array.isArray(mapping.titles)?mapping.titles.filter(Boolean).map(String):[]
  };
}

async function searchAnime(query){
  if(!query)return[];
  const url=`${AJAX_URL}/anime/search?keyword=${encodeURIComponent(query)}`;
  const body=await getJson(url,{"headers":HEADERS},10000);
  const html=body?.result?.html;
  if(!html)return[];
  const $=cheerio.load(html);
  const results=[];
  $("div.scaff.items").children().each((_,item)=>{
    const el=$(item);
    const title=el.find(".name.d-title").first().text().trim();
    const href=el.attr("href");
    const image=el.find("img").first().attr("src")||"";
    if(title&&href){
      results.push({title,url:new URL(href,ANIKOTO_URL).href,image});
    }
  });
  return results;
}

function rankSearchResults(results,titles){
  const targets=unique(titles).map(normalizeTitle).filter(Boolean);
  return [...results].sort((a,b)=>{
    const score=(item)=>{
      const t=normalizeTitle(item.title);
      if(targets.includes(t))return 100;
      if(targets.some(x=>t.includes(x)||x.includes(t)))return 80;
      return 0;
    };
    return score(b)-score(a);
  });
}

async function getEpisodeList(animeUrl){
  const page=await getText(animeUrl,{"headers":HEADERS},10000);
  if(!page)return null;
  const $=cheerio.load(page);
  const watchId=$("#watch-main").attr("data-id")?.trim();
  if(!watchId){
    log(`No watch-main data-id for ${animeUrl}`);
    return null;
  }
  const episodeUrl=`${AJAX_URL}/episode/list/${encodeURIComponent(watchId)}?vrf=`;
  const data=await getJson(episodeUrl,{"headers":HEADERS},10000);
  const html=data?.result;
  if(!html)return null;
  const doc=cheerio.load(html);
  const episodes=[];
  doc.querySelectorAll("div.episodes > *").forEach(range=>{
    range.children.forEach(node=>{
      if(node.type!=="tag")return;
      const a=node.querySelector("a");
      if(!a)return;
      const attrs=a.attribs||{};
      const href=attrs.href?new URL(attrs.href,ANIKOTO_URL).href:null;
      const episodeId=attrs["data-ids"]?.trim();
      const malId=attrs["data-mal"]?.trim();
      const number=parsePositiveInt(attrs["data-num"]);
      if(!number)return;
      episodes.push({
        episodeId,
        href,
        malId:malId||null,
        episodeNumber:number,
        title:attrs.title?.trim()||"",
        dub:attrs["data-dub"]==="1",
        filler:String(attrs.class||"").split(/\s+/).includes("filler")
      });
    });
  });
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
    const episodes=await getEpisodeList(candidate.url);
    if(!episodes?.length)continue;
    const exact=episodes.find(ep=>ep.malId===mapping.malId&&ep.episodeNumber===mapping.malEpisode);
    if(exact?.episodeId){
      log(`Matched "${candidate.title}" MAL=${mapping.malId} E${mapping.malEpisode}`);
      return{candidate,episode:exact,episodes};
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
  const data=await getJson(url,{"headers":HEADERS},10000);
  return data?.["Kiwi-Stream-"]||null;
}

async function getServerLinks(episodeId,dub){
  const url=`${AJAX_URL}/server/list?servers=${encodeURIComponent(episodeId)}`;
  const body=await getJson(url,{"headers":HEADERS},10000);
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
  const body=await getJson(url,{"headers":HEADERS},10000);
  return body?.result?.url?String(body.result.url).trim():null;
}

function base64UrlDecode(value){
  return Buffer.from(String(value).replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(String(value).length/4)*4,"="),"base64");
}

function sourceFile(response){
  const encrypted=response?.enc;
  if(typeof encrypted==="string"&&encrypted){
    try{
      const key=Buffer.alloc(32);
      Buffer.from("i?LMTAx0Q6,:}50U","utf8").copy(key);
      const iv=Buffer.from("W0;27ToaUpl_P%'c","utf8");
      const decipher=crypto.createDecipheriv("aes-256-cbc",key,iv);
      const plaintext=Buffer.concat([decipher.update(base64UrlDecode(encrypted)),decipher.final()]).toString("utf8");
      const decoded=JSON.parse(plaintext);
      if(typeof decoded?.file==="string"&&decoded.file)return decoded.file;
    }catch(error){
      log(`Megaplay encrypted source decode failed: ${error.message}`);
    }
  }
  if(response?.sources&&typeof response.sources==="object"&&!Array.isArray(response.sources)&&typeof response.sources.file==="string")return response.sources.file;
  if(Array.isArray(response?.sources)&&response.sources.length&&typeof response.sources[0]?.file==="string")return response.sources[0].file;
  return null;
}

function signMegaplayUrl(fileUrl){
  try{
    const uri=new URL(fileUrl);
    const match=uri.pathname.match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
    if(!match)return fileUrl;
    const expires=Math.floor(Date.now()/1000)+90;
    const payload=Buffer.from(`${expires}|${match[1].toLowerCase()}/${match[2].toLowerCase()}`,"utf8");
    const signature=crypto.createHmac("sha256","MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s").update(payload).digest();
    const enc=buffer=>buffer.toString("base64url").replace(/=+$/,"");
    uri.searchParams.set("token",`${enc(payload)}.${enc(signature)}`);
    return uri.toString();
  }catch(_){
    return fileUrl;
  }
}

function subtitleFormat(url,declared){
  const allowed=new Set(["srt","vtt","ass"]);
  const fromDeclared=String(declared||"").toLowerCase().replace(/^\./,"");
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
  const page=await getText(url,{"headers":HEADERS},10000);
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
      "X-Requested-With":"XMLHttpRequest",
      "Referer":"https://vidtube.site/"
    }
  },10000);
  const playlist=response?.sources?.file;
  if(!playlist)return[];
  const tracks=Array.isArray(response?.tracks)?response.tracks:[];
  let sub=tracks.find(t=>t&&t.kind==="captions"&&String(t.lang||"").toLowerCase()==="english")?.file;
  if(!sub)sub=tracks.find(t=>t&&t.kind==="captions"&&t.default===true)?.file;
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
    subtitles:sub?[{url:sub,name:"English",language:"en",format:"vtt",default:true}]:[],
    backup:false
  }];
}

async function extractMegaplay(url,server){
  const page=await getText(url,{"headers":HEADERS},10000);
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
          "Referer":url,
          "User-Agent":HEADERS["User-Agent"]
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
  const english=tracks.find(t=>t&&t.kind==="captions"&&String(t.label||"").toLowerCase()==="english")
    ||tracks.find(t=>t&&t.kind==="captions"&&t.default===true);
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
    subtitles:sub?[{url:sub,name:"English",language:"en",format:subtitleFormat(sub,english?.format),default:true}]:[],
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
      if(!streamUrl)continue;
      const extracted=await extractStream(streamUrl,server.name);
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
      log("AniKoto provider requires a TV/anime series mapping");
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
    const streams=await fetchStreamsForEpisode(match.episode.episodeId,mapping.malId,mapping.malEpisode,dub);
    log(`Streams found: ${streams.length}`);
    return streams;
  }catch(error){
    log(`Fatal: ${error.message}`);
    return[];
  }
}

module.exports={getStreams};
