const BASE="https://anizone.to",MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping",TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706",UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36",HEADERS={"User-Agent":UA,"Referer":BASE+"/"},TIMEOUT=15000;

function mergeHeaders(a,b){
const o={};
let k;
a=a||{};
b=b||{};
for(k in a)if(Object.prototype.hasOwnProperty.call(a,k))o[k]=a[k];
for(k in b)if(Object.prototype.hasOwnProperty.call(b,k))o[k]=b[k];
return o
}

function mergeOptions(opt,extra){
const o={};
let k;
opt=opt||{};
for(k in opt)if(Object.prototype.hasOwnProperty.call(opt,k))o[k]=opt[k];
for(k in extra||{})if(Object.prototype.hasOwnProperty.call(extra,k))o[k]=extra[k];
o.headers=mergeHeaders(HEADERS,opt.headers||{});
if(extra&&extra.headers)o.headers=mergeHeaders(o.headers,extra.headers);
return o
}

async function req(url,opt,timeout){
opt=opt||{};
timeout=timeout||TIMEOUT;
const o=mergeOptions(opt,{});
if(typeof AbortController!=="function"||typeof setTimeout!=="function")return fetch(url,o).catch(function(){return null});
const c=new AbortController(),t=setTimeout(function(){c.abort()},timeout);
try{
return await fetch(url,mergeOptions(o,{signal:c.signal}))
}catch(e){
return null
}finally{
clearTimeout(t)
}
}

async function text(url,opt,timeout){
const r=await req(url,opt,timeout);
if(!r||!r.ok)return"";
try{
return await r.text()
}catch(e){
return""
}
}

async function json(url,opt,timeout){
const r=await req(url,opt,timeout);
if(!r||!r.ok)return null;
try{
return await r.json()
}catch(e){
return null
}
}

function attrs(s){
const o={};
String(s||"").replace(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,function(m,k,a,b,c){
o[k]=a!=null?a:b!=null?b:c!=null?c:"";
return m
});
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
const n={type:"element",name:name,attrs:attrs(m[2]),children:[]};
stack[stack.length-1].children.push(n);
if(!/\/>$/.test(full)&&["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"].indexOf(name)<0)stack.push(n)
}
last=re.lastIndex
}
if(last<src.length)stack[stack.length-1].children.push({type:"text",text:src.slice(last)});
return root
}

function children(n){
return n&&n.children||[]
}

function match(n,sel){
if(!n||n.type!=="element")return false;
if(sel[0]==="#")return n.attrs.id===sel.slice(1);
if(sel[0]===".")return String(n.attrs.class||"").split(/\s+/).indexOf(sel.slice(1))>=0;
if(sel[0]==="["){
const m=sel.match(/^\[([^\\]=~*^$]+)(?:([~*^$]?=)["']?([^"'\\]]+)["']?)?\]$/);
if(!m)return false;
const v=n.attrs[m[1]];
if(v==null)return false;
if(!m[2])return true;
if(m[2]==="=")return v===m[3];
if(m[2]==="*=")return v.indexOf(m[3])>=0;
if(m[2]==="~=")return v.split(/\s+/).indexOf(m[3])>=0;
if(m[2]==="^=")return v.indexOf(m[3])===0;
if(m[2]==="$=")return v.slice(-m[3].length)===m[3]
}
return n.name===sel.toLowerCase()
}

function all(root,sel){
const out=[];
function walk(n){
if(n&&n.type==="element"&&match(n,sel))out.push(n);
const cs=children(n);
for(let i=0;i<cs.length;i++)walk(cs[i])
}
walk(root);
return out
}

function first(root,sel){
return all(root,sel)[0]||null
}

function nodeText(n){
if(!n)return"";
if(n.type==="text")return n.text||"";
const cs=children(n);
let out="";
for(let i=0;i<cs.length;i++)out+=nodeText(cs[i]);
return out
}

function attr(n,k){
return n&&n.attrs?n.attrs[k]:undefined
}

function sanitizeJson(s){
return String(s||"")
.replace(/\\u0022/g,'"')
.replace(/\\u0026/g,"&")
.replace(/\\'/g,"'")
.replace(/\\\//g,"/")
.replace(/\\\\/g,"\\")
.replace(/\\&/g,"&")
.replace(/\\0/g,"\\u0000")
.replace(/\\x([0-9a-fA-F]{2})/g,function(_,h){return"\\u00"+h})
.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g,"")
}

function decodeJSON(s){
try{
return JSON.parse(sanitizeJson(s))
}catch(e){
return null
}
}

function parseCards(html){
const root=parseHTML(html),main=first(root,"main");
if(!main)return[];
const kids=children(main);
if(kids.length<2)return[];
const data=attr(kids[1],"x-data")||"";
const marker="items: JSON.parse('";
const p=data.indexOf(marker);
if(p<0)return[];
const start=p+marker.length;
let end=-1;
for(let i=start;i<data.length;i++){
if(data[i]==="'"&&data[i-1]!=="\\"){
end=i;
break
}
}
if(end<0)return[];
const d=decodeJSON(data.slice(start,end));
if(!Array.isArray(d))return[];
const out=[];
for(let i=0;i<d.length;i++){
const x=d[i];
if(!x||!x.main_title||!x.url)continue;
const titles=[String(x.main_title)];
if(x.title_list&&typeof x.title_list==="object"){
const vals=Object.values(x.title_list);
for(let j=0;j<vals.length;j++)titles.push(String(vals[j]))
}
const slug=String(x.url).replace(/\\/g,"");
out.push({slug:slug,url:slug,titles:titles})
}
return out
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
if(Array.isArray(c.titles))for(let i=0;i<c.titles.length;i++)out.push(c.titles[i]);
const keys=["main_title","title","name","anime_title","animeTitle","en","english","romaji","original_title","originalTitle"];
for(let i=0;i<keys.length;i++){
const k=keys[i];
if(c[k])out.push(c[k])
}
if(c.title_list&&typeof c.title_list==="object"){
const vals=Object.values(c.title_list);
for(let i=0;i<vals.length;i++)out.push(vals[i])
}
const seen={};
const result=[];
for(let i=0;i<out.length;i++){
const x=String(out[i]||"").trim();
if(x&&!seen[x]){
seen[x]=true;
result.push(x)
}
}
return result
}

function normalize(s){
return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"").trim()
}

function seasonNumber(v){
const s=String(v||"").toLowerCase();
let m=s.match(/\b(?:season|saison)\s*(\d+)\b/);
if(m)return Number(m[1]);
m=s.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/);
if(m)return Number(m[1]);
m=s.match(/\bpart\s*(\d+)\b/);
if(m)return Number(m[1]);
m=s.match(/(?:^|[\s-])(ii|iii|iv|v|vi|vii|viii|ix|x)(?:$|[\s-])/i);
if(m){
const map={ii:2,iii:3,iv:4,v:5,vi:6,vii:7,viii:8,ix:9,x:10};
return map[m[1].toLowerCase()]||null
}
return null
}

function matchCard(cards,targetTitles,baseTitle,season,seasonName){
const s=Number(season)||1;
const base=normalize(baseTitle);
const sn=normalize(seasonName);
const targets=[];
const input=targetTitles||[];
for(let i=0;i<input.length;i++){
const n=normalize(input[i]);
if(n)targets.push(n)
}
console.log("[ANIZONE LAZY] SEASON RESOLUTION S"+s+" candidates="+cards.length+" seasonTitle="+seasonName);
const ranked=[];
for(let i=0;i<cards.length;i++){
const c=cards[i],titles=cardTitles(c),label=titles.join(" | ");
let explicit=null;
for(let j=0;j<titles.length;j++){
const n=seasonNumber(titles[j]);
if(n!=null){
explicit=n;
break
}
}
if(explicit==null)explicit=seasonNumber(cardSlug(c));

let baseMatch=!base;
if(!baseMatch){
for(let j=0;j<titles.length;j++){
const n=normalize(titles[j]);
if(n===base||n.indexOf(base)>=0||base.indexOf(n)>=0){
baseMatch=true;
break
}
}
}

if(!baseMatch){
console.log("[ANIZONE LAZY] CANDIDATE REJECTED slug="+cardSlug(c)+" reason=title-mismatch titles="+label);
continue
}

if(explicit!=null&&explicit!==s){
console.log("[ANIZONE LAZY] CANDIDATE REJECTED slug="+cardSlug(c)+" reason=wrong-season candidate="+explicit+" requested="+s);
continue
}

if(s===1&&/\b(?:movie|film|gekijouban)\b/i.test(label)){
console.log("[ANIZONE LAZY] CANDIDATE REJECTED slug="+cardSlug(c)+" reason=movie");
continue
}

let score=0,reason="";
let seasonExact=false,seasonPartial=false;

if(sn){
for(let j=0;j<titles.length;j++){
const n=normalize(titles[j]);
if(n===sn){
seasonExact=true;
break
}
}
if(seasonExact){
score+=100;
reason="season-title-exact"
}else{
for(let j=0;j<titles.length;j++){
const n=normalize(titles[j]);
if(n.indexOf(sn)>=0||sn.indexOf(n)>=0){
seasonPartial=true;
break
}
}
if(seasonPartial){
score+=80;
reason="season-title"
}
}
}

let mappedTitle=false;
for(let j=0;j<targets.length;j++){
for(let k=0;k<titles.length;k++){
if(normalize(titles[k])===targets[j]){
mappedTitle=true;
break
}
}
if(mappedTitle)break
}
if(mappedTitle){
score+=50;
if(!reason)reason="mapped-title"
}

if(explicit===s){
score+=100;
if(!reason)reason="explicit-season"
}

if(s===1&&explicit==null){
score+=20;
if(!reason)reason="base-season-1"
}

if(s>1&&explicit==null&&score<80){
console.log("[ANIZONE LAZY] CANDIDATE REJECTED slug="+cardSlug(c)+" reason=no-season-evidence");
continue
}

ranked.push({c:c,score:score,reason:reason})
}

ranked.sort(function(a,b){return b.score-a.score});
if(!ranked.length)return null;

if(ranked.length>1&&ranked[0].score===ranked[1].score&&ranked[0].score<100){
console.log("[ANIZONE LAZY] SEASON AMBIGUOUS requested="+s);
return null
}

const best=ranked[0];
console.log("[ANIZONE LAZY] CANDIDATE MATCHED slug="+cardSlug(best.c)+" season="+s+" reason="+best.reason+" score="+best.score);
return cardSlug(best.c)
}

function matchMovieCard(cards,targetTitles){
const targets=[];
const input=targetTitles||[];
for(let i=0;i<input.length;i++){
const n=normalize(input[i]);
if(n&&targets.indexOf(n)<0)targets.push(n)
}

for(let i=0;i<cards.length;i++){
const titles=cardTitles(cards[i]);
for(let j=0;j<titles.length;j++){
if(targets.indexOf(normalize(titles[j]))>=0)return cardSlug(cards[i])
}
}

for(let i=0;i<cards.length;i++){
const titles=cardTitles(cards[i]);
for(let j=0;j<titles.length;j++){
const n=normalize(titles[j]);
for(let k=0;k<targets.length;k++){
if(n.indexOf(targets[k])>=0||targets[k].indexOf(n)>=0)return cardSlug(cards[i])
}
}
}

return cards[0]?cardSlug(cards[0]):null
}

async function searchCards(q){
if(!q)return[];
console.log("[ANIZONE LAZY] SEARCH query="+q);
const h=await text(BASE+"/anime?search="+encodeURIComponent(q),{
headers:{
"Accept":"text/html,application/xhtml+xml",
"User-Agent":UA
}
},9000);
return h?parseCards(h):[]
}

function parseVidstack(html){
const src=String(html||"");
let payload="";
const marker="vidstackPlayer(JSON.parse('");
const p=src.indexOf(marker);

if(p>=0){
const start=p+marker.length;
let end=-1;
for(let i=start;i<src.length;i++){
if(src[i]==="'"&&src[i-1]!=="\\"){
end=i;
break
}
}
if(end>start)payload=src.slice(start,end)
}

if(payload){
const d=decodeJSON(payload);
if(d&&d.src){
const subtitles=[];
const input=Array.isArray(d.subtitles)?d.subtitles:[];
for(let i=0;i<input.length;i++){
const s=input[i];
const u=String(s.file||"").replace(/\\/g,"");
if(u)subtitles.push({
url:u,
name:s.title||s.language||"English",
language:s.language||"en"
})
}
return{
masterUrl:String(d.src).replace(/\\/g,""),
subtitles:subtitles
}
}
}

const root=parseHTML(src);
let masterUrl=attr(first(root,"media-player"),"src")||"";

if(!masterUrl){
const u=src.match(/https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*/i);
if(u)masterUrl=u[0]
}

const subtitles=[];
const tracks=all(root,"track");

for(let i=0;i<tracks.length;i++){
const t=tracks[i];
const u=attr(t,"src")||"";
const kind=String(attr(t,"kind")||"").toLowerCase();
if(u&&(kind==="subtitles"||kind==="captions"||/\.(ass|vtt)(?:\?|$)/i.test(u))){
subtitles.push({
url:u,
name:attr(t,"label")||"English",
language:attr(t,"srclang")||"en"
})
}
}

return{
masterUrl:masterUrl,
subtitles:subtitles
}
}

function parseAudioFormat(s){
const x=String(s||"").toLowerCase();
const j=x.includes("japanese")||x.includes("jpn")||x.includes("ja");
const e=x.includes("english")||x.includes("eng")||x.includes("en");
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
try{
html=await r.text()
}catch(e){
return null
}

let cookie="";
try{
if(r.headers&&typeof r.headers.getSetCookie==="function"){
const cs=r.headers.getSetCookie();
const parts=[];
for(let i=0;i<cs.length;i++)parts.push(cs[i].split(";")[0]);
cookie=parts.join("; ")
}else if(r.headers&&r.headers.get){
cookie=r.headers.get("set-cookie")||""
}
}catch(e){}

return{
html:html,
cookie:cookie
}
}

async function getTmdbInfo(tmdbId,mediaType){
const type=mediaType==="movie"?"movie":"tv";
const d=await json(
"https://api.themoviedb.org/3/"+type+"/"+encodeURIComponent(tmdbId)+"?api_key="+TMDB_API_KEY+"&language=en-US",
{headers:{"Accept":"application/json"}},
7000
);

if(!d)return null;

return{
title:d.name||d.title||d.original_name||d.original_title||"",
originalTitle:d.original_name||d.original_title||""
}
}

async function dbMapping(tmdbId,season,episode){
tmdbId=String(tmdbId||"").trim();
season=Number(season)||1;
episode=Number(episode)||1;

if(!tmdbId)return null;

const u=MAPPING_URL+
"?tmdb_id="+encodeURIComponent(tmdbId)+
"&tmdbId="+encodeURIComponent(tmdbId)+
"&season="+season+
"&episode="+episode;

const d=await json(u,{headers:{"Accept":"application/json"}},8000);

if(d&&d.ok&&d.mapping){
console.log("[ANIZONE LAZY] DB HIT TMDB="+tmdbId+" S"+season+"E"+episode);
return{
mapping:d.mapping,
state:d.state||null
}
}

console.log("[ANIZONE LAZY] DB MISS TMDB="+tmdbId+" S"+season+"E"+episode);
return null
}

function mapTitle(m){
return String(m&&(m.anime_title||m.title||m.name||m.mal_title)||"").trim()
}

function mapEp(m,fallback){
const n=Number(m&&(m.mal_episode!=null?m.mal_episode:m.episode!=null?m.episode:m.malEpisode));
return Number.isFinite(n)&&n>0?n:Number(fallback)||1
}

function mapTitles(m){
const a=[];
if(m&&Array.isArray(m.titles)){
for(let i=0;i<m.titles.length;i++)a.push(m.titles[i])
}
const t=mapTitle(m);
if(t)a.push(t);

const seen={};
const out=[];
for(let i=0;i<a.length;i++){
const x=String(a[i]||"").trim();
if(x&&!seen[x]){
seen[x]=true;
out.push(x)
}
}
return out
}

function mapMalId(m){
const v=m&&(m.mal_id!=null?m.mal_id:m.malId!=null?m.malId:m.id);
return v==null?"":String(v)
}

function cleanQuery(s){
return String(s||"")
.split(":")[0]
.replace(/season.*|\d+(?:st|nd|rd|th)\s+season|saison.*/i,"")
.trim()
}

async function resolveStream(tmdbId,mediaType,season,episode){
tmdbId=String(tmdbId||"").trim();
mediaType=String(mediaType||"tv").toLowerCase();
season=Number(season)||1;
episode=Number(episode)||1;

if(!tmdbId)return[];

console.log("[ANIZONE LAZY] REQUEST TMDB="+tmdbId+" S"+season+"E"+episode);

const movie=mediaType==="movie";
let title="";
let targetTitles=[];
let malEpisode=episode;
let seasonName="";
let malId="";

if(!movie){
const mr=await dbMapping(tmdbId,season,episode);

if(!mr||!mr.mapping)return[];

const m=mr.mapping;

title=mapTitle(m);
targetTitles=mapTitles(m);
malEpisode=mapEp(m,episode);
seasonName=String(m.season_title||m.season_name||m.seasonName||"");
malId=mapMalId(m);

console.log(
"[ANIZONE LAZY] MAPPED MAL="+malId+
" E"+malEpisode+
" TITLE="+title+
" REQUESTED_SEASON="+season+
" SEASON_TITLE="+seasonName
)
}else{
const info=await getTmdbInfo(tmdbId,"movie");
if(!info||!info.title)return[];
title=info.title
}

const base=cleanQuery(title)||title;
let cards=await searchCards(base);

if(!cards.length&&title!==base){
cards=await searchCards(title)
}

console.log("[ANIZONE LAZY] SEARCH RESULTS="+cards.length);

if(!cards.length)return[];

const slug=movie
?matchMovieCard(cards,targetTitles.length?targetTitles:[title])
:matchCard(cards,targetTitles,title,season,seasonName);

if(!slug)return[];

console.log("[ANIZONE LAZY] FETCH EPISODE="+malEpisode+" SLUG="+slug);

const page=await episodePage(slug,malEpisode);
if(!page)return[];

const root=parseHTML(page.html);
const parsed=parseVidstack(page.html);
const streams=[];
const seen={};
const buttons=all(root,"button").filter(function(b){
return String(attr(b,"wire:click")||"").indexOf("setVideo")>=0
});

let defaultFormat="Sub";
let defaultServerName="AniZone";

if(buttons.length){
const label=nodeText(buttons[0]).replace(/\s+/g," ").trim();
defaultFormat=parseAudioFormat(label);
const nm=label.match(/^([A-Za-z0-9_-]+)/);
if(nm)defaultServerName=nm[1]
}

if(parsed.masterUrl){
seen[parsed.masterUrl]=true;

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

jobs.push((async function(){
try{
const body={
_token:csrf,
components:[{
snapshot:snapshot,
updates:{},
calls:[{
path:"",
method:"setVideo",
params:[videoId]
}]
}]
};

const requestHeaders={
"Accept":"*/*",
"Content-Type":"application/json",
"X-Livewire":"",
"X-CSRF-TOKEN":csrf,
"Origin":BASE,
"Referer":BASE+"/anime/"+slug+"/"+malEpisode,
"Cookie":page.cookie
};

if(componentId)requestHeaders["X-Livewire-Id"]=componentId;

const r=await req(
BASE+"/livewire/update",
{
method:"POST",
headers:requestHeaders,
body:JSON.stringify(body)
},
8000
);

if(!r||!r.ok)return null;

let raw="";
try{
raw=await r.text()
}catch(e){
return null
}

let data=null;

try{
data=JSON.parse(raw)
}catch(e){}

let html="";

if(
data&&
data.components&&
data.components[0]&&
data.components[0].effects
){
html=data.components[0].effects.html||""
}

if(!html)html=raw;
if(!html)return null;

const p=parseVidstack(html);

if(!p.masterUrl||seen[p.masterUrl])return null;

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
return null
}
})())
}

const extra=await Promise.all(jobs);

for(let i=0;i<extra.length;i++){
const x=extra[i];

if(x&&x.stream&&!seen[x.url]){
seen[x.url]=true;
streams.push(x.stream)
}
}
}
}

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
console.log("[ANIZONE LAZY] ERROR "+String(e));
return[]
}
}

module.exports={getStreams:getStreams};
