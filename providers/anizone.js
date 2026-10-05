const BASE="https://anizone.to",MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-mapping",UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";
function log(x){console.log("[AniZone] "+x)}
async function req(url,opt,timeoutMs=5000){opt=opt||{};const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);try{return await fetch(url,Object.assign({},opt,{signal:c.signal}))}finally{clearTimeout(t)}}
async function text(url,opt){try{const r=await req(url,opt);if(!r.ok){log("HTTP "+r.status+" "+url);return null}return await r.text()}catch(e){log("Request failed "+url+": "+e.message);return null}}
async function json(url,opt){try{const r=await req(url,opt);if(!r.ok){log("HTTP "+r.status+" "+url);return null}return await r.json()}catch(e){log("JSON request failed "+url+": "+e.message);return null}}
function attrs(s){const o={};let i=0,n=String(s||"");while(i<n.length){while(i<n.length&&/[\s\/]/.test(n[i]))i++;let k="";while(i<n.length&&/[^\s=\/>]/.test(n[i]))k+=n[i++];if(!k)break;while(i<n.length&&/\s/.test(n[i]))i++;let v="";if(n[i]==="="){i++;while(i<n.length&&/\s/.test(n[i]))i++;if(n[i]==='"'||n[i]==="'"){const q=n[i++];while(i<n.length&&n[i]!==q)v+=n[i++];if(n[i]===q)i++}else while(i<n.length&&!/[\s>]/.test(n[i]))v+=n[i++]}o[k.toLowerCase()]=v}return o}
const VOID={area:1,base:1,br:1,col:1,embed:1,hr:1,img:1,input:1,link:1,meta:1,param:1,source:1,track:1,wbr:1};
function unesc(s){return String(s||"").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)))}
function parseHTML(src){const root={tag:"root",a:{},c:[],t:""},st=[root],s=String(src||"");let i=0;while(i<s.length){if(s[i]!=="<"){let j=s.indexOf("<",i);if(j<0)j=s.length;st[st.length-1].t+=unesc(s.slice(i,j));i=j;continue}if(s.slice(i,i+4)==="<!--"){const j=s.indexOf("-->",i+4);i=j<0?s.length:j+3;continue}if(/^<!doctype/i.test(s.slice(i,i+10))){const j=s.indexOf(">",i+2);i=j<0?s.length:j+1;continue}if(s.slice(i,i+2)==="</"){const m=/^<\s*\/\s*([^\s>]+)/.exec(s.slice(i));if(m){const j=s.indexOf(">",i+m[0].length);i=j<0?s.length:j+1;for(let k=st.length-1;k>0;k--)if(st[k].tag===m[1].toLowerCase()){st.length=k;break}continue}}const m=/^<\s*([^\s/>]+)/.exec(s.slice(i));if(!m){i++;continue}let j=i+m[0].length,q=null;for(let k=j;k<s.length;k++){if(s[k]==="'"||s[k]==='"'){if(q===null)q=s[k];else if(q===s[k])q=null}else if(s[k]===">"&&q===null){j=k;break}}if(j<=i){i++;continue}const raw=s.slice(i,j+1),tag=m[1].toLowerCase(),a=attrs(raw.slice(m[0].length,-1)),n={tag,a,c:[],t:""};st[st.length-1].c.push(n);i=j+1;if(!VOID[tag]&&!/\/\s*>$/.test(raw)){st.push(n);if(tag==="script"||tag==="style"){const close=new RegExp("<\\/\\s*"+tag+"\\s*>","i"),tail=s.slice(i),cm=close.exec(tail);if(cm){n.t+=tail.slice(0,cm.index);i+=cm.index+cm[0].length;st.pop()}}}}return root}
function children(n){return n&&Array.isArray(n.c)?n.c:[]}
function hasClass(n,c){return(" "+String(n&&n.a&&n.a.class||"").replace(/\s+/g," ")+" ").indexOf(" "+c+" ")>=0}
function match(n,sel){if(!n||n.tag==="root")return false;const tm=sel.match(/^[a-z0-9_-]+/i);if(tm&&n.tag!==tm[0].toLowerCase())return false;const im=sel.match(/#([a-z0-9_-]+)/i);if(im&&n.a.id!==im[1])return false;const cm=sel.match(/\.([a-z0-9_-]+)/gi)||[];for(const c of cm)if(!hasClass(n,c.slice(1)))return false;return true}
function all(n,sel,o){o=o||[];for(const x of children(n)){if(match(x,sel))o.push(x);all(x,sel,o)}return o}
function first(n,sel){return all(n,sel,[])[0]||null}
function nodeText(n){let s=n&&n.t||"";for(const x of children(n))s+=nodeText(x);return unesc(s).replace(/\s+/g," ").trim()}
function dataAttr(n,k){return n&&n.a&&n.a[k.toLowerCase()]||""}
function decodeJSON(s){try{return JSON.parse(String(s||"").replace(/\\u0022/g,'"'))}catch(e){log("JSON decode failed: "+e.message);return null}}
function extractJSONParse(s){const m=/JSON\.parse$begin:math:text$\'\(\.\+\?\)\'$end:math:text$/s.exec(String(s||""));return m?decodeJSON(m[1]):null}
async function mapping(tmdbId,season,episode){const u=MAPPING_URL+"?tmdbId="+encodeURIComponent(tmdbId)+"&season="+encodeURIComponent(season)+"&episode="+encodeURIComponent(episode),d=await json(u,{headers:{"Accept":"application/json","User-Agent":UA}});if(!d||!d.ok||!d.mapping)return null;const m=d.mapping,mal=String(m.mal_id||m.malId||"").trim(),ep=Number(m.mal_episode||m.target_episode||0);if(!mal||!ep)return null;return{malId:mal,malEpisode:ep,title:String(m.anime_title||m.title||"").trim(),titles:Array.isArray(m.titles)?m.titles.filter(Boolean).map(String):[]}}
const LAZY_MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping",TMDB_API="https://api.themoviedb.org/3",TMDB_KEY="68e094699525b18a70bab2f86b1fa706";
async function lazyMapping(tmdbId,season,episode){const d=await json(LAZY_MAPPING_URL+"?tmdb_id="+encodeURIComponent(tmdbId)+"&tmdbId="+encodeURIComponent(tmdbId)+"&season="+season+"&episode="+episode,{headers:{"Accept":"application/json","User-Agent":UA}},2500);if(!d||!d.ok||!d.mapping)return null;const m=d.mapping,mal=String(m.mal_id||m.malId||"").trim(),ep=Number(m.mal_episode||m.target_episode||0);if(!mal||!ep)return null;return{malId:mal,malEpisode:ep,title:String(m.anime_title||m.title||"").trim(),titles:Array.isArray(m.titles)?m.titles.filter(Boolean).map(String):[]}}
async function resolveTmdbId(id,type){id=String(id||"").trim();if(/^\d+$/.test(id)||!/^tt\d+$/i.test(id))return id;try{const t=String(type||"tv").toLowerCase()==="movie"?"movie_results":"tv_results",d=await json(TMDB_API+"/find/"+encodeURIComponent(id)+"?api_key="+encodeURIComponent(TMDB_KEY)+"&external_source=imdb_id",{headers:{"Accept":"application/json","User-Agent":UA}},2500);const a=d&&Array.isArray(d[t])?d[t]:[];return a[0]&&a[0].id?String(a[0].id):id}catch(e){return id}}
async function tmdbInfo(tmdbId,type){const t=String(type||"tv").toLowerCase()==="movie"?"movie":"tv",d=await json(TMDB_API+"/"+t+"/"+encodeURIComponent(tmdbId)+"?api_key="+encodeURIComponent(TMDB_KEY)+"&language=en-US",{headers:{"Accept":"application/json","User-Agent":UA}},2500);if(!d)return null;return{title:String(d.name||d.title||d.original_name||d.original_title||"").trim(),originalTitle:String(d.original_name||d.original_title||"").trim()}}
async function search(query){query=String(query||"").trim();if(!query)return[];const url=BASE+"/anime?search="+encodeURIComponent(query),html=await text(url,{headers:{"Accept":"text/html,application/xhtml+xml","User-Agent":UA}});if(!html)return[];const root=parseHTML(html),main=first(root,"main");if(!main){log("Search: main not found");return[]}const kids=children(main);if(kids.length<2){log("Search: expected main child[1]");return[]}const data=dataAttr(kids[1],"x-data"),parsed=extractJSONParse(data);if(!Array.isArray(parsed)){log("Search: JSON.parse data not found");return[]}const out=[];for(const item of parsed){const title=item&&item.main_title,img=item&&item.cover,href=item&&item.url;if(title==null||img==null||href==null)continue;out.push({name:String(title),alias:String(href).replace(/\\/g,""),imageUrl:String(img)})}log("Search '"+query+"' -> "+out.length+" results");return out}
function exactResult(results,query){return results.find(x=>String(x&&x.name||"")===String(query))||null}
async function findAnime(m){
 const qs=[];
 if(m.title)qs.push(m.title);
 for(const t of m.titles||[])if(t&&!qs.includes(t))qs.push(t);
 if(!qs.length)return null;
 let fallback=null;
 for(let i=0;i<qs.length;i++){
  const q=String(qs[i]).trim();
  if(!q)continue;
  const r=await search(q);
  if(!r.length)continue;
  const exact=exactResult(r,q);
  if(exact){log("Exact AniZone match: "+exact.name);return exact}
  if(!fallback){fallback=r[0];log("No exact match; AnimeStream fallback: "+fallback.name)}
 }
 return fallback
}
async function getEpisodes(alias){const html=await text(alias,{headers:{"Accept":"text/html,application/xhtml+xml","User-Agent":UA}});if(!html)return[];const root=parseHTML(html),main=first(root,"main");if(!main)return[];const kids=children(main);if(!kids.length)return[];const data=dataAttr(kids[0],"x-data"),m=/items:\s*JSON\.parse$begin:math:text$\'\(\.\+\?\)\'$end:math:text$/s.exec(data||"");if(!m){log("Episodes: JSON.parse items not found");return[]}const list=decodeJSON(m[1]);if(!Array.isArray(list))return[];const out=[];let i=1;for(const item of list){if(!item||!item.url)continue;out.push({episodeLink:String(item.url).replace(/\\/g,""),episodeNumber:i,thumbnail:item.snapshot?String(item.snapshot).replace(/\\/g,""):"",episodeTitle:item.title_list&&item.title_list["1"],isFiller:String(item.type||"").toLowerCase()==="filler",hasDub:false});i++}log("Episodes: parsed "+out.length);return out}
async function getEpisodeStream(episodeUrl){const html=await text(episodeUrl,{headers:{"Accept":"text/html,application/xhtml+xml","User-Agent":UA}});if(!html)return null;const root=parseHTML(html),div=first(root,"div.mb-8");if(!div)return null;const kids=children(div);if(!kids.length)return null;const data=dataAttr(kids[0],"x-data"),parsed=extractJSONParse(data);if(!parsed||!parsed.src){log("Stream: source not found");return null}const src=String(parsed.src).replace(/\\/g,""),subs=Array.isArray(parsed.subtitles)?parsed.subtitles:[],en=subs.find(x=>x&&x.language==="en"&&x.default===true),button=first(root,"button.flex.gap-2.relative");return{name:"AniZone",title:"AniZone • "+(button?nodeText(button):"Default"),url:src,quality:"multi-quality",headers:{"Referer":BASE+"/","User-Agent":UA},subtitle:en&&en.file?String(en.file).replace(/\\/g,""):"",subtitleFormat:en&&en.format?String(en.format):"",backup:false}}
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
      const stream=await getEpisodeStream(ep.episodeLink);
      return stream?[stream]:null
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
    const out=await Promise.race([mapped(),new Promise((_,reject)=>setTimeout(()=>reject(new Error("mapped deadline")),Math.min(9000,Math.max(500,deadline-Date.now()))))]);
    if(out&&out.length)return out
  }catch(e){log("Mapped path failed: "+e.message)}
  const fallback=async()=>{
    const info=await tmdbInfo(id,type);
    if(!info||!info.title)return[];
    const qs=[info.title];
    if(info.originalTitle&&info.originalTitle!==info.title)qs.push(info.originalTitle);
    if(type==="tv"&&s>1)qs.push(info.title+" season "+s);
    let anime=null;
    for(const q of qs){
      const r=await search(q),exact=exactResult(r,q);
      if(exact){anime=exact;break}
      if(!anime&&r.length)anime=r[0]
    }
    if(!anime)return[];
    const eps=await getEpisodes(anime.alias),target=type==="movie"?1:e,ep=eps.find(x=>x.episodeNumber===target);
    if(!ep)return[];
    const stream=await getEpisodeStream(ep.episodeLink);
    return stream?[stream]:[]
  };
  try{return await Promise.race([fallback(),new Promise((_,reject)=>setTimeout(()=>reject(new Error("fallback deadline")),Math.max(100,deadline-Date.now())))])}catch(e){log("AniZone deadline reached: "+e.message);return[]}
}
module.exports={getStreams};
