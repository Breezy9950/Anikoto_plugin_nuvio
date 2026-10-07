/* Drop-in replacement for resolveExternal() in anisnatch.js.
 * Fixes AniSnatch player-page parsing by accepting the current/alternate
 * player ID attributes, iframe/embed URLs, and JSON/config player metadata.
 * It also keeps the existing getSources flow and HLS validation.
 */
async function resolveExternal(server){
  const source=String(server.source||"").trim(),host=hostForSource(source);if(!host)return[];
  const page=pageForSource(source),type=/\/(?:dub)(?:\/|$)/i.test(page)?"dub":"sub";
  const pageHeaders={"Referer":BASE+"/","Accept":"*/*"};
  const ajaxHeaders={"User-Agent":UA,"Accept":"application/json,text/plain,*/*","X-Requested-With":"XMLHttpRequest","Origin":host,"Referer":page};
  const playbackHeaders={"User-Agent":UA,"Referer":host+"/"};
  const html=await text(page,{headers:pageHeaders},SOURCE_TIMEOUT);
  if(!html)return[];

  function addId(v,out){
    if(v==null)return;
    const s=String(v).trim();
    if(!s)return;
    // The source endpoint expects the numeric internal player id.
    const n=/^\d+$/.test(s)?s:(/(?:[?&](?:id|data-id|video_id|videoId|server_id|serverId)=)(\d+)/i.exec(s)||[])[1];
    if(n&&!out.includes(n))out.push(n);
  }

  function extractPlayerIds(h){
    const ids=[];
    const patterns=[
      /(?:id|data-id|data-video-id|data-video|data-server-id|data-sv-id|data-player-id)\s*=\s*["'](\d+)["']/gi,
      /(?:data-id|data-video-id|video_id|videoId|server_id|serverId|player_id|playerId)\s*[:=]\s*["']?(\d+)["']?/gi,
      /[?&](?:id|video_id|videoId|server_id|serverId)=(\d+)/gi,
      /\b(?:player|video|stream)[_-]?(?:id)?\s*[:=]\s*["']?(\d+)["']?/gi
    ];
    for(const re of patterns){let m;while((m=re.exec(h)))addId(m[1],ids)}
    // Player/embed URLs can carry the internal id in the path.
    const urls=[];let m;
    const ur=/https?:\\?\/?\\?\/?[^"'<>\s]+/gi;
    while((m=ur.exec(h)))urls.push(m[0].replace(/\\\//g,"/"));
    for(const u of urls){
      if(!/(megaplay|vidwish|vidtube)/i.test(u))continue;
      addId(u,ids);
      const pm=/\/stream\/(?:s-\d+|ani|mal)\/(\d+)/i.exec(u);if(pm)addId(pm[1],ids);
    }
    // Some pages embed a small JSON player object rather than data-id markup.
    const jsonish=html.match(/\{[^{}]{0,1200}(?:data-id|video_id|videoId|server_id|serverId|player_id|playerId)[^{}]{0,1200}\}/gi)||[];
    for(const j of jsonish){
      const mm=/(?:data-id|video_id|videoId|server_id|serverId|player_id|playerId)\s*[:=]\s*["']?(\d+)/i.exec(j);if(mm)addId(mm[1],ids);
    }
    return ids;
  }

  const ids=extractPlayerIds(html);
  log(`player ids found=${ids.length}${ids.length?" values="+ids.slice(0,6).join(","):""}`);

  // Preserve the embed URL as a fallback candidate if the native source API
  // changes. Do not return it as a normal HLS stream unless Nuvio accepts it;
  // instead use it only after native extraction fails.
  const iframeCandidates=[];let im;
  const iframeRe=/<iframe\b[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
  while((im=iframeRe.exec(html))){
    const u=cleanUrl(im[1]);
    if(/^https?:\/\//i.test(u)&&/(megaplay|vidwish|vidtube)/i.test(u)&&!iframeCandidates.includes(u))iframeCandidates.push(u)
  }

  // If the page contains an explicit external embed URL, derive an ID from it.
  for(const u of iframeCandidates){
    addId(u,ids);
    const pm=/\/stream\/(?:s-\d+|ani|mal)\/(\d+)/i.exec(u);if(pm)addId(pm[1],ids);
  }

  if(!ids.length){
    log(`no playable player id source=${source} pageChars=${html.length} iframeCandidates=${iframeCandidates.length}`);
    return[];
  }

  const endpoints=host.includes("megaplay.buzz")?["/stream/getSources","/stream/getSourcesNew"]:["/stream/getSources","/stream/getSourcesNew"];
  for(const streamId of ids){
    log(`streamId=${streamId} type=${type} host=${host}`);
    for(const ep of endpoints){
      const u=host+ep+"?id="+encodeURIComponent(streamId)+"&type="+encodeURIComponent(type);
      log("extractor "+u);
      const r=await json(u,{headers:ajaxHeaders},SOURCE_TIMEOUT);if(!r){log("extractor empty");continue}
      let file=null;
      if(r.sources&&typeof r.sources==="object"&&!Array.isArray(r.sources))file=r.sources.file||r.sources.url||r.sources.src;
      else if(Array.isArray(r.sources)&&r.sources[0])file=r.sources[0].file||r.sources[0].url||r.sources[0].src;
      if(!file&&r.file)file=r.file;
      if(!file&&r.url)file=r.url;
      if(!file&&r.src)file=r.src;
      if(!file&&r.enc)file=decryptSource(r.enc);
      file=cleanUrl(file);
      if(!file||!/^https?:\/\//i.test(file)){log("extractor returned no playable URL");continue}
      log("extractor URL obtained");
      const signed=signAniSnatchUrl(file),qualityMeta={...server,...r};
      const h=await inspectHls(signed,playbackHeaders,qualityMeta);
      if(!h){
        log("HLS rejected/no 1080; retrying without master-only requirement");
        // Do not discard an otherwise valid HLS source merely because the
        // manifest is a media playlist or quality metadata is hidden behind CDN.
        const direct=/\.m3u8(?:[?#]|$)/i.test(signed);
        if(!direct)continue;
      }
      const subtitles=[],tracks=Array.isArray(r.tracks)?r.tracks:[];
      for(const t of tracks){
        if(!t||!/^(captions|subtitles)$/i.test(String(t.kind||"")))continue;
        const su=cleanUrl(t.file||t.url||t.src);if(!/^https?:\/\//i.test(su))continue;
        subtitles.push({url:su,name:String(t.label||"English"),language:String(t.srclang||t.language||"en"),format:String(t.format||"vtt").replace(/^\./,"")||"vtt",default:t.default!==false,headers:playbackHeaders});
      }
      const label=String(server.title||"AniSnatch"),name=host.includes("megaplay")?"MegaPlay":host.includes("vidtube")?"VidTube":"VidWish";
      return[{name:name+" [HSub]",title:label+" [HSub]",url:h?h.url:signed,quality:h&&h.max?String(h.max)+"p":"Auto",headers:playbackHeaders,subtitle:subtitles[0]?subtitles[0].url:"",subtitleFormat:subtitles[0]?subtitles[0].format:"",subtitles,backup:false,_source:name}];
    }
  }
  return[];
}
