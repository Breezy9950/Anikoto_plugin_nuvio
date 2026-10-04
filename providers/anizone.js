const BASE="https://anizone.to",MAPPING_URL="https://breezy-plugins.netlify.app/.netlify/functions/anime-mapping",UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";
function log(x){console.log("[AniZone] "+x)}
async function req(url,opt){opt=opt||{};const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);try{return await fetch(url,Object.assign({},opt,{signal:c.signal}))}finally{clearTimeout(t)}}
async function text(url,opt){try{const r=await req(url,opt);if(!r.ok){log("HTTP "+r.status+" "+url);return null}return await r.text()}catch(e){log("Request failed "+url+": "+e.message);return null}}
async function json(url,opt){try{const r=await req(url,opt);if(!r.ok){log("HTTP "+r.status+" "+url);return null}return await r.json()}catch(e){log("JSON request failed "+url+": "+e.message);return null}}
function attrs(s){const o={};String(s||"").replace(/([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,(_,k,a,b,c)=>{o[k.toLowerCase()]=a!==undefined?a:b!==undefined?b:c!==undefined?c:"";return _});return o}
const VOID={area:1,base:1,br:1,col:1,embed:1,hr:1,img:1,input:1,link:1,meta:1,param:1,source:1,track:1,wbr:1};
function unesc(s){return String(s||"").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)))}
function parseHTML(src){const root={tag:"root",a:{},c:[],t:""},st=[root],rx=/<[^>]+>|[^<]+/g;let m;while((m=rx.exec(String(src||"")))){const x=m[0];if(x[0]!=="<"){st[st.length-1].t+=unesc(x);continue}if(/^<!--/.test(x))continue;if(/^<\//.test(x)){const q=x.match(/^<\s*\/\s*([^\s>]+)/);if(q){for(let i=st.length-1;i>0;i--)if(st[i].tag===q[1].toLowerCase()){st.length=i;break}}continue}const q=x.match(/^<\s*([^\s/>]+)/);if(!q)continue;const tag=q[1].toLowerCase(),a=attrs(x.slice(q[0].length,-1)),n={tag,a,c:[],t:""};st[st.length-1].c.push(n);if(!VOID[tag]&&!/\/\s*>$/.test(x))st.push(n)}return root}
function children(n){return n&&n.c||[]}
function hasClass(n,c){return(" "+String(n&&n.a&&n.a.class||"").replace(/\s+/g," ")+" ").indexOf(" "+c+" ")>=0}
function match(n,sel){if(!n||n.tag==="root")return false;const tm=sel.match(/^[a-z0-9_-]+/i);if(tm&&n.tag!==tm[0].toLowerCase())return false;const im=sel.match(/#([a-z0-9_-]+)/i);if(im&&n.a.id!==im[1])return false;const cm=sel.match(/\.([a-z0-9_-]+)/gi)||[];for(const c of cm)if(!hasClass(n,c.slice(1)))return false;return true}
function all(n,sel,o){o=o||[];for(const x of children(n)){if(match(x,sel))o.push(x);all(x,sel,o)}return o}
function first(n,sel){return all(n,sel,[])[0]||null}
function nodeText(n){let s=n&&n.t||"";for(const x of children(n))s+=nodeText(x);return unesc(s).replace(/\s+/g," ").trim()}
function dataAttr(n,k){return n&&n.a&&n.a[k.toLowerCase()]||""}
function decodeJSON(s){try{return JSON.parse(String(s||"").replace(/\\u0022/g,'"').replace(/\\u0027/g,"'").replace(/\\\//g,"/").replace(/\\\\/g,"\\"))}catch(e){return null}}
function extractJSONParse(s){const m=/JSON\.parse$begin:math:text$\'\(\.\+\?\)\'$end:math:text$/s.exec(String(s||""));return m?decodeJSON(m[1]):null}
function getXData(n){return dataAttr(n,"x-data")}
async function mapping(tmdbId,season,episode){
  const u=MAPPING_URL+"?tmdbId="+encodeURIComponent(tmdbId)+"&season="+encodeURIComponent(season)+"&episode="+encodeURIComponent(episode);
  const d=await json(u,{headers:{"Accept":"application/json","User-Agent":UA}});
  if(!d||!d.ok||!d.mapping)return null;
  const m=d.mapping,mal=String(m.mal_id||m.malId||"").trim(),ep=Number(m.mal_episode||m.target_episode||0);
  if(!mal||!ep)return null;
  return{malId:mal,malEpisode:ep,title:String(m.anime_title||"").trim(),titles:Array.isArray(m.titles)?m.titles.filter(Boolean).map(String):[]}
}
async function search(query){
  query=String(query||"").trim();
  if(!query)return[];
  const url=BASE+"/anime?search="+encodeURIComponent(query);
  const html=await text(url,{headers:{"Accept":"text/html,application/xhtml+xml","User-Agent":UA}});
  if(!html)return[];
  const root=parseHTML(html),main=first(root,"main");
  if(!main||children(main).length<2){log("Search main structure not found");return[]}
  const data=getXData(children(main)[1]);
  const parsed=extractJSONParse(data);
  if(!Array.isArray(parsed)){log("Search JSON not found");return[]}
  const out=[];
  for(const item of parsed){
    const title=item&&item.main_title,img=item&&item.cover,href=item&&item.url;
    if(title==null||img==null||href==null)continue;
    out.push({name:String(title),alias:String(href).replace(/\\/g,""),imageUrl:String(img)})
  }
  log("Search "+query+" -> "+out.length);
  return out
}
function normalize(s){return String(s||"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g,"").trim()}
async function findAnime(m){
  const qs=[m.title,...m.titles].filter(Boolean),allr=[];
  for(const q of qs){
    const r=await search(q);
    for(const x of r)if(!allr.some(y=>y.alias===x.alias))allr.push(x);
    const exact=r.find(x=>x.name===q);
    if(exact)return exact
  }
  for(const q of qs){
    const n=normalize(q),exact=allr.find(x=>normalize(x.name)===n);
    if(exact)return exact
  }
  return allr[0]||null
}
async function getEpisodes(alias){
  const html=await text(alias,{headers:{"Accept":"text/html,application/xhtml+xml","User-Agent":UA}});
  if(!html)return[];
  const root=parseHTML(html),main=first(root,"main");
  if(!main||!children(main).length){log("Episode main structure not found");return[]}
  const data=getXData(children(main)[0]);
  const m=/items:\s*JSON\.parse$begin:math:text$\'\(\.\+\?\)\'$end:math:text$/s.exec(data||"");
  if(!m){log("Episode JSON not found");return[]}
  const list=decodeJSON(m[1]);
  if(!Array.isArray(list)){log("Episode JSON invalid");return[]}
  const out=[];let i=1;
  for(const item of list){
    if(!item||!item.url)continue;
    const title=item.title_list&&item.title_list["1"];
    const img=item.snapshot?String(item.snapshot).replace(/\\/g,""):undefined;
    out.push({episodeLink:String(item.url).replace(/\\/g,""),episodeNumber:i,thumbnail:img,episodeTitle:title,isFiller:String(item.type||"").toLowerCase()==="filler",hasDub:false});
    i++
  }
  log("Episodes -> "+out.length);
  return out
}
async function getEpisodeStream(episodeUrl){
  const html=await text(episodeUrl,{headers:{"Accept":"text/html,application/xhtml+xml","User-Agent":UA}});
  if(!html)return null;
  const root=parseHTML(html),div=first(root,"div.mb-8");
  if(!div||!children(div).length){log("Stream data div not found");return null}
  const data=getXData(children(div)[0]);
  const parsed=extractJSONParse(data);
  if(!parsed||!parsed.src){log("Stream JSON/source not found");return null}
  const src=String(parsed.src).replace(/\\/g,"");
  const subs=Array.isArray(parsed.subtitles)?parsed.subtitles:[];
  const en=subs.find(x=>x&&x.language==="en"&&x.default===true);
  const subtitle=en&&en.file?String(en.file).replace(/\\/g,""):"";
  const format=en&&en.format?String(en.format):"";
  const button=first(root,"button.flex.gap-2.relative");
  const server=button?nodeText(button):"Default";
  log("Stream found: "+server);
  return{name:"AniZone",title:"AniZone • "+server,url:src,quality:"multi-quality",headers:{"Referer":BASE+"/","User-Agent":UA},subtitle,subtitleFormat:format,backup:false}
}
async function getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){
  try{
    if(String(mediaType).toLowerCase()!=="tv")return[];
    const m=await mapping(tmdbId,season,episode);
    if(!m){log("No mapping for TMDB="+tmdbId+" S"+season+"E"+episode);return[]}
    log("Mapping TMDB="+tmdbId+" S"+season+"E"+episode+" -> MAL="+m.malId+" E"+m.malEpisode);
    const anime=await findAnime(m);
    if(!anime){log("Anime not found: "+m.title);return[]}
    log("Matched "+anime.name+" -> "+anime.alias);
    const eps=await getEpisodes(anime.alias);
    const ep=eps.find(x=>x.episodeNumber===m.malEpisode);
    if(!ep){log("Episode "+m.malEpisode+" not found for "+anime.name);return[]}
    log("Episode matched -> "+ep.episodeLink);
    const stream=await getEpisodeStream(ep.episodeLink);
    return stream?[stream]:[]
  }catch(e){log("Fatal: "+e.message);return[]}
}
module.exports={getStreams};
