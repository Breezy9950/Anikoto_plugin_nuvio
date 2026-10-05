const BASE="https://anizone.to";
const MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-mapping";
const UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";
const MAP_TTL=86400000;
const SEARCH_TTL=86400000;
const EPISODE_TTL=3600000;
const STREAM_TTL=1800000;
const REQUEST_TIMEOUT=10000;
const FAST_TIMEOUT=4500;

function log(x){console.log("[AniZone] "+x)}

var CACHE=globalThis.__NUVIO_ANIZONE_CACHE__;
if(!CACHE){
  CACHE={data:{},expires:{},pending:{}};
  globalThis.__NUVIO_ANIZONE_CACHE__=CACHE;
}

function cacheGet(key){
  var exp=CACHE.expires[key];
  if(!exp)return undefined;
  if(exp<=Date.now()){
    delete CACHE.data[key];
    delete CACHE.expires[key];
    return undefined;
  }
  return CACHE.data[key];
}

function cacheSet(key,value,ttl){
  CACHE.data[key]=value;
  CACHE.expires[key]=Date.now()+ttl;
  return value;
}

function cacheDelete(key){
  delete CACHE.data[key];
  delete CACHE.expires[key];
}

function memo(key,ttl,fn){
  var hit=cacheGet(key);
  if(hit!==undefined)return Promise.resolve(hit);

  if(CACHE.pending[key])return CACHE.pending[key];

  var p=Promise.resolve().then(fn);

  CACHE.pending[key]=p;

  return p.then(function(value){
    delete CACHE.pending[key];
    cacheSet(key,value,ttl);
    return value;
  },function(error){
    delete CACHE.pending[key];
    cacheDelete(key);
    throw error;
  });
}

function withTimeout(promise,ms){
  var timer;
  return Promise.race([
    promise,
    new Promise(function(_,reject){
      timer=setTimeout(function(){
        reject(new Error("timeout"));
      },ms);
    })
  ]).then(function(value){
    clearTimeout(timer);
    return value;
  },function(error){
    clearTimeout(timer);
    throw error;
  });
}

function parallel(items,worker,timeoutMs){
  var jobs=[];
  for(var i=0;i<items.length;i++){
    jobs.push(
      withTimeout(
        Promise.resolve().then((function(item){
          return function(){return worker(item)};
        })(items[i])),
        timeoutMs||FAST_TIMEOUT
      ).then(function(value){
        return {ok:true,value:value};
      },function(error){
        return {ok:false,error:error};
      })
    );
  }

  return Promise.all(jobs).then(function(results){
    var out=[];
    for(var i=0;i<results.length;i++){
      if(results[i].ok&&results[i].value!==null&&results[i].value!==undefined){
        out.push(results[i].value);
      }
    }
    return out;
  });
}

function request(url,options,timeoutMs){
  options=options||{};

  var controller=null;
  var timer=null;

  try{
    if(typeof AbortController!=="undefined"){
      controller=new AbortController();
      options.signal=controller.signal;
    }
  }catch(e){}

  var ms=timeoutMs||REQUEST_TIMEOUT;

  timer=setTimeout(function(){
    try{
      if(controller)controller.abort();
    }catch(e){}
  },ms);

  return fetch(url,options).then(function(response){
    clearTimeout(timer);
    return response;
  },function(error){
    clearTimeout(timer);
    throw error;
  });
}

function getText(url,options,timeoutMs){
  return request(url,options,timeoutMs).then(function(response){
    if(!response.ok){
      log("HTTP "+response.status+" "+url);
      return null;
    }
    return response.text();
  }).catch(function(error){
    log("Request failed "+url+": "+error.message);
    return null;
  });
}

function getJSON(url,options,timeoutMs){
  return request(url,options,timeoutMs).then(function(response){
    if(!response.ok){
      log("HTTP "+response.status+" "+url);
      return null;
    }
    return response.json();
  }).catch(function(error){
    log("JSON request failed "+url+": "+error.message);
    return null;
  });
}

function unescapeHTML(value){
  return String(value||"")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&#(\d+);/g,function(_,n){
      return String.fromCharCode(Number(n));
    })
    .replace(/&#x([0-9a-f]+);/gi,function(_,n){
      return String.fromCharCode(parseInt(n,16));
    });
}

function clean(value){
  if(value===null||value===undefined)return "";
  return String(value).replace(/\\/g,"").trim();
}

function unique(values){
  var result=[];
  var seen={};

  for(var i=0;i<values.length;i++){
    if(!values[i])continue;

    var value=String(values[i]);
    var key=value.toLowerCase();

    if(seen[key])continue;

    seen[key]=true;
    result.push(value);
  }

  return result;
}

function normalize(value){
  return String(value||"")
    .toLowerCase()
    .replace(/&/g,"and")
    .replace(/[^a-z0-9]+/g,"");
}

function decodeJSON(value){
  try{
    var s=String(value||"");
    s=s.replace(/\\u0022/g,'"');
    s=s.replace(/\\u0027/g,"'");
    s=s.replace(/\\"/g,'"');
    s=s.replace(/\\'/g,"'");
    return JSON.parse(s);
  }catch(error){
    log("JSON decode failed: "+error.message);
    return null;
  }
}

function extractJSONParse(value){
  var s=String(value||"");

  var match=/JSON\.parse\s*\(\s*(['"])([\s\S]*?)\1\s*\)/.exec(s);

  if(!match)return null;

  return decodeJSON(match[2]);
}

/*
 * Lightweight HTML parser.
 * Only used for bounded AniZone HTML extraction.
 */
function parseHTML(source){
  var root={
    tag:"root",
    attrs:{},
    children:[],
    text:""
  };

  var stack=[root];
  var html=String(source||"");
  var i=0;

  while(i<html.length){

    if(html.charAt(i)!=="<"){
      var next=html.indexOf("<",i);

      if(next<0)next=html.length;

      stack[stack.length-1].text+=unescapeHTML(html.slice(i,next));
      i=next;
      continue;
    }

    if(html.slice(i,i+4)==="<!--"){
      var commentEnd=html.indexOf("-->",i+4);
      i=commentEnd<0?html.length:commentEnd+3;
      continue;
    }

    if(/^<!doctype/i.test(html.slice(i,i+10))){
      var doctypeEnd=html.indexOf(">",i+2);
      i=doctypeEnd<0?html.length:doctypeEnd+1;
      continue;
    }

    if(html.slice(i,i+2)==="</"){
      var closeMatch=/^<\s*\/\s*([^\s>]+)/.exec(html.slice(i));

      if(closeMatch){
        var closeEnd=html.indexOf(">",i+closeMatch[0].length);

        if(closeEnd<0){
          i=html.length;
        }else{
          i=closeEnd+1;
        }

        var closingTag=closeMatch[1].toLowerCase();

        for(var c=stack.length-1;c>0;c--){
          if(stack[c].tag===closingTag){
            stack.length=c;
            break;
          }
        }

        continue;
      }
    }

    var openMatch=/^<\s*([^\s/>]+)/.exec(html.slice(i));

    if(!openMatch){
      i++;
      continue;
    }

    var tag=openMatch[1].toLowerCase();
    var end=i+openMatch[0].length;
    var quote=null;

    for(var p=end;p<html.length;p++){
      var ch=html.charAt(p);

      if(ch==="'"||ch==='"'){
        if(quote===null)quote=ch;
        else if(quote===ch)quote=null;
      }else if(ch===">"&&quote===null){
        end=p;
        break;
      }
    }

    if(end<=i){
      i++;
      continue;
    }

    var raw=html.slice(i,end+1);
    var node={
      tag:tag,
      attrs:{},
      children:[],
      text:""
    };

    var attrPart=raw.slice(openMatch[0].length,-1);

    attrPart.replace(
      /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
      function(_,name,a,b,c){
        node.attrs[String(name).toLowerCase()]=
          a!==undefined?a:
          b!==undefined?b:
          c!==undefined?c:"";
        return _;
      }
    );

    stack[stack.length-1].children.push(node);

    i=end+1;

    if(!/\/\s*>$/.test(raw)&&
      tag!=="area"&&
      tag!=="base"&&
      tag!=="br"&&
      tag!=="col"&&
      tag!=="embed"&&
      tag!=="hr"&&
      tag!=="img"&&
      tag!=="input"&&
      tag!=="link"&&
      tag!=="meta"&&
      tag!=="param"&&
      tag!=="source"&&
      tag!=="track"&&
      tag!=="wbr"
    ){
      stack.push(node);

      if(tag==="script"||tag==="style"){
        var closeRegex=new RegExp("<\\/\\s*"+tag+"\\s*>","i");
        var remaining=html.slice(i);
        var closeMatch2=closeRegex.exec(remaining);

        if(closeMatch2){
          node.text+=remaining.slice(0,closeMatch2.index);
          i+=closeMatch2.index+closeMatch2[0].length;
          stack.pop();
        }
      }
    }
  }

  return root;
}

function findAll(node,selector,result){
  result=result||[];

  if(!node)return result;

  var tagMatch=/^[a-z0-9_-]+/i.exec(selector);

  if(tagMatch&&node.tag===tagMatch[0].toLowerCase()){
    var idMatch=/#([a-z0-9_-]+)/i.exec(selector);
    var classMatches=selector.match(/\.([a-z0-9_-]+)/gi)||[];

    var good=true;

    if(idMatch&&node.attrs.id!==idMatch[1]){
      good=false;
    }

    for(var i=0;i<classMatches.length;i++){
      var cls=classMatches[i].slice(1);
      var classes=" "+String(node.attrs.class||"").replace(/\s+/g," ")+" ";

      if(classes.indexOf(" "+cls+" ")<0){
        good=false;
        break;
      }
    }

    if(good)result.push(node);
  }

  var children=node.children||[];

  for(var j=0;j<children.length;j++){
    findAll(children[j],selector,result);
  }

  return result;
}

function first(node,selector){
  var result=findAll(node,selector,[]);
  return result.length?result[0]:null;
}

function textOf(node){
  if(!node)return "";

  var value=node.text||"";
  var children=node.children||[];

  for(var i=0;i<children.length;i++){
    value+=textOf(children[i]);
  }

  return unescapeHTML(value).replace(/\s+/g," ").trim();
}

function getAttribute(node,name){
  if(!node||!node.attrs)return "";
  return node.attrs[String(name).toLowerCase()]||"";
}

/* =========================
   MAPPING
========================= */

function mapping(tmdbId,season,episode){
  var key="mapping:"+tmdbId+":"+season+":"+episode;

  return memo(key,MAP_TTL,function(){

    var url=
      MAPPING_URL+
      "?tmdbId="+encodeURIComponent(tmdbId)+
      "&season="+encodeURIComponent(season)+
      "&episode="+encodeURIComponent(episode);

    return getJSON(
      url,
      {
        headers:{
          Accept:"application/json",
          "User-Agent":UA
        }
      },
      7000
    ).then(function(data){

      if(!data||!data.ok||!data.mapping){
        return null;
      }

      var m=data.mapping;

      var malId=String(
        m.mal_id||
        m.malId||
        ""
      ).trim();

      var malEpisode=Number(
        m.mal_episode||
        m.target_episode||
        0
      );

      if(!malId||!malEpisode){
        return null;
      }

      return {
        malId:malId,
        malEpisode:malEpisode,
        title:String(m.anime_title||"").trim(),
        titles:Array.isArray(m.titles)?
          m.titles.filter(Boolean).map(String):
          []
      };
    });
  });
}

/* =========================
   ANIZONE SEARCH
========================= */

function search(query){

  query=String(query||"").trim();

  if(!query)return Promise.resolve([]);

  var key="search:"+query.toLowerCase();

  return memo(key,SEARCH_TTL,function(){

    var url=BASE+"/anime?search="+encodeURIComponent(query);

    return getText(
      url,
      {
        headers:{
          Accept:"text/html,application/xhtml+xml",
          "Accept-Encoding":"gzip, br",
          "User-Agent":UA
        }
      },
      FAST_TIMEOUT
    ).then(function(html){

      if(!html)return [];

      /*
       * Restrict parsing to <main>.
       * This avoids walking the entire document.
       */
      var main=/<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
      var source=main?main[1]:html;

      var dataMatch=/x-data\s*=\s*(["'])([\s\S]*?)\1/i.exec(source);

      if(!dataMatch)return [];

      var parsed=extractJSONParse(dataMatch[2]);

      if(!Array.isArray(parsed)){
        return [];
      }

      var result=[];

      for(var i=0;i<parsed.length;i++){

        var item=parsed[i];

        if(!item)continue;

        var title=item.main_title;
        var cover=item.cover;
        var url2=item.url;

        if(title===undefined||!url2){
          continue;
        }

        result.push({
          name:String(title),
          alias:clean(url2),
          imageUrl:clean(cover||"")
        });
      }

      return result;
    });
  });
}

/* =========================
   FIND ANIME
========================= */

function findAnime(mappingResult){

  var queries=unique(
    [mappingResult.title].concat(mappingResult.titles||[])
  );

  if(!queries.length){
    return Promise.resolve(null);
  }

  var normalized=[];

  for(var i=0;i<queries.length;i++){
    normalized.push(normalize(queries[i]));
  }

  normalized.sort();

  var key="find:"+normalized.join("|");

  return memo(key,SEARCH_TTL,function(){

    return parallel(
      queries,
      function(query){
        return search(query);
      },
      FAST_TIMEOUT
    ).then(function(results){

      /*
       * Exact match first.
       */
      for(var i=0;i<queries.length;i++){

        var query=queries[i];
        var target=normalize(query);

        for(var r=0;r<results.length;r++){

          var list=results[r];

          if(!Array.isArray(list))continue;

          for(var x=0;x<list.length;x++){

            if(normalize(list[x].name)===target){
              return list[x];
            }
          }
        }
      }

      /*
       * Fallback.
       */
      for(var a=0;a<results.length;a++){
        if(results[a]&&results[a].length){
          return results[a][0];
        }
      }

      return null;
    });
  });
}

/* =========================
   EPISODES
========================= */

function getEpisodes(alias){

  var key="episodes:"+alias;

  return memo(key,EPISODE_TTL,function(){

    return getText(
      alias,
      {
        headers:{
          Accept:"text/html,application/xhtml+xml",
          "Accept-Encoding":"gzip, br",
          "User-Agent":UA
        }
      },
      FAST_TIMEOUT
    ).then(function(html){

      if(!html)return [];

      var main=/<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
      var source=main?main[1]:html;

      var dataMatch=/x-data\s*=\s*(["'])([\s\S]*?)\1/i.exec(source);

      if(!dataMatch)return [];

      var data=dataMatch[2];

      var parsed=extractJSONParse(data);

      if(!Array.isArray(parsed)){

        var itemMatch=
          /items\s*:\s*JSON\.parse\s*$begin:math:text$\\s\*\(\[\'\"\]\)\(\[\\s\\S\]\*\?\)\\1\\s\*$end:math:text$/i.exec(data);

        if(itemMatch){
          parsed=decodeJSON(itemMatch[2]);
        }
      }

      if(!Array.isArray(parsed)){
        return [];
      }

      var result=[];
      var number=0;

      for(var i=0;i<parsed.length;i++){

        var item=parsed[i];

        if(!item||!item.url){
          continue;
        }

        number++;

        result.push({
          episodeLink:clean(item.url),
          episodeNumber:number,
          thumbnail:clean(item.snapshot||""),
          episodeTitle:
            item.title_list&&
            item.title_list["1"]?
            item.title_list["1"]:
            "",
          isFiller:
            String(item.type||"").toLowerCase()==="filler",
          hasDub:false
        });
      }

      log("Episodes parsed: "+result.length);

      return result;
    });
  });
}

/* =========================
   STREAM RESOLUTION
========================= */

function getEpisodeStream(episodeUrl){

  var key="stream:"+episodeUrl;

  return memo(key,STREAM_TTL,function(){

    return getText(
      episodeUrl,
      {
        headers:{
          Accept:"text/html,application/xhtml+xml",
          "Accept-Encoding":"gzip, br",
          "User-Agent":UA
        }
      },
      FAST_TIMEOUT
    ).then(function(html){

      if(!html)return null;

      /*
       * Only inspect the player container.
       */
      var player=
        /<div\b[^>]*class\s*=\s*(["'])[^"']*\bmb-8\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/i.exec(html);

      var source=player?player[2]:html;

      var dataMatch=
        /x-data\s*=\s*(["'])([\s\S]*?)\1/i.exec(source);

      if(!dataMatch){
        return null;
      }

      var data=extractJSONParse(dataMatch[2]);

      if(!data||!data.src){
        return null;
      }

      var streamUrl=clean(data.src);

      if(!streamUrl){
        return null;
      }

      var subtitleList=
        Array.isArray(data.subtitles)?
        data.subtitles:
        [];

      var english=null;

      for(var i=0;i<subtitleList.length;i++){

        var sub=subtitleList[i];

        if(
          sub&&
          String(sub.language||"").toLowerCase()==="en"&&
          sub.default===true
        ){
          english=sub;
          break;
        }
      }

      if(!english){

        for(var j=0;j<subtitleList.length;j++){

          var sub2=subtitleList[j];

          if(
            sub2&&
            String(sub2.language||"").toLowerCase()==="en"
          ){
            english=sub2;
            break;
          }
        }
      }

      var button=
        /<button\b[^>]*class\s*=\s*(["'])[^"']*\bflex\b[^"']*\bgap-2\b[^"']*\brelative\b[^"']*\1[^>]*>([\s\S]*?)<\/button>/i.exec(html);

      var sourceName="Default";

      if(button){
        sourceName=
          unescapeHTML(
            button[2].replace(/<[^>]+>/g," ")
          ).replace(/\s+/g," ").trim()||"Default";
      }

      var subtitle=
        english&&english.file?
        clean(english.file):
        "";

      var format=
        english&&english.format?
        String(english.format):
        "";

      var isM3U8=
        /\.m3u8(?:$|\?)/i.test(streamUrl);

      return {
        name:"AniZone",
        title:"AniZone • "+sourceName,
        url:streamUrl,
        quality:"multi-quality",
        headers:{
          Referer:BASE+"/",
          "User-Agent":UA
        },
        subtitle:subtitle,
        subtitleFormat:format,
        subtitles:subtitle?
          [{
            url:subtitle,
            name:"English",
            language:"en",
            format:format,
            default:true,
            headers:{
              Referer:BASE+"/",
              "User-Agent":UA
            }
          }]:
          [],
        backup:false,
        isM3U8:isM3U8
      };
    });
  });
}

/* =========================
   PUBLIC NUVIO PROVIDER
========================= */

function getStreams(
  tmdbId,
  mediaType,
  season,
  episode,
  settings
){

  mediaType=mediaType||"tv";
  season=Number(season)||1;
  episode=Number(episode)||1;
  settings=settings||{};

  if(String(mediaType).toLowerCase()!=="tv"){
    return Promise.resolve([]);
  }

  var id=String(tmdbId||"").trim();

  if(!id){
    return Promise.resolve([]);
  }

  var finalKey=
    "final:"+
    id+
    ":"+
    season+
    ":"+
    episode;

  var cached=cacheGet(finalKey);

  if(cached!==undefined){

    log("FINAL CACHE HIT "+id+" S"+season+"E"+episode);

    return Promise.resolve(cached);
  }

  return memo(finalKey,STREAM_TTL,function(){

    return mapping(
      id,
      season,
      episode
    ).then(function(map){

      if(!map){
        log(
          "No mapping TMDB="+
          id+
          " S"+
          season+
          "E"+
          episode
        );

        return [];
      }

      log(
        "Mapping TMDB="+
        id+
        " -> MAL="+
        map.malId+
        " E"+
        map.malEpisode
      );

      return findAnime(map);
    }).then(function(anime){

      if(!anime){
        log("AniZone anime not found");
        return null;
      }

      log(
        "AniZone match: "+
        anime.name
      );

      return getEpisodes(anime.alias).then(function(episodes){

        if(!episodes||!episodes.length){
          log("AniZone returned no episodes");
          return null;
        }

        var target=null;

        for(var i=0;i<episodes.length;i++){

          if(
            Number(episodes[i].episodeNumber)===
            Number(
              /*
               * Mapping is needed here, therefore attach it
               * through the outer lookup below.
               */
              0
            )
          ){
            target=episodes[i];
            break;
          }
        }

        return {
          anime:anime,
          episodes:episodes
        };
      });
    }).then(function(data){

      if(!data){
        return [];
      }

      /*
       * Resolve mapping again from the 24h cache.
       * This is an in-memory hit and produces no network request.
       */
      return mapping(
        id,
        season,
        episode
      ).then(function(map){

        if(!map){
          return [];
        }

        var target=null;

        for(var i=0;i<data.episodes.length;i++){

          if(
            Number(data.episodes[i].episodeNumber)===
            Number(map.malEpisode)
          ){
            target=data.episodes[i];
            break;
          }
        }

        if(!target){

          log(
            "MAL episode "+
            map.malEpisode+
            " not found; available="+
            data.episodes.length
          );

          return [];
        }

        log(
          "Resolving AniZone episode "+
          target.episodeNumber
        );

        return getEpisodeStream(
          target.episodeLink
        ).then(function(stream){

          if(!stream){
            return [];
          }

          return [stream];
        });
      });
    });
  }).catch(function(error){

    log("Fatal: "+error.message);

    cacheDelete(finalKey);

    return [];
  });
}

module.exports={
  getStreams:getStreams
};
