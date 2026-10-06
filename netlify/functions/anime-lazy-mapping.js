const{getStore}=require("@netlify/blobs");
const STORE="anime-lazy-resolution",MAX_ID=50,MAX_EP=100000,MAX_WINDOW=12,LOCK_TTL=2*60*1000,TIMEOUT=6000,CONCURRENCY=4,TMDB_KEY=process.env.TMDB_API_KEY||"68e094699525b18a70bab2f86b1fa706",SHINKRO_URL=process.env.ANIME_MAPPING_URL||"https://anikoto-nuvio.netlify.app/.netlify/functions/anime-mapping";
function log(x){console.log(`[ANIME LAZY MAPPING] ${x}`)}
function json(status,body){return{statusCode:status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type"},body:JSON.stringify(body)}}
function num(v,max=MAX_EP){const n=Number(v);return Number.isInteger(n)&&n>=0&&n<=max?n:null}
function pos(v){const n=num(v);return n&&n>0?n:null}
function db(){return getStore({name:STORE,siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN})}
async function fetchJson(url,timeout=TIMEOUT){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{headers:{Accept:"application/json","User-Agent":"Anikoto-Nuvio-Lazy/1.0"},signal:c.signal});if(!r.ok){log(`HTTP ${r.status} ${url.split("?")[0]}`);return{state:r.status===429?"RATE_LIMITED":"HTTP_ERROR",data:null}}try{return{state:"HIT",data:await r.json()}}catch(e){return{state:"MALFORMED",data:null}}}catch(e){const m=String(e&&e.message||e);return{state:/abort|timeout/i.test(m)?"TIMEOUT":"UNKNOWN",data:null}}finally{clearTimeout(t)}}
function day(v){const s=v?String(v).split("T")[0]:"";return/^\d{4}-\d\d-\d\d$/.test(s)?s:""}
function dateMatch(a,b){a=day(a);b=day(b);if(!a||!b)return false;return Math.abs(new Date(a+"T00:00:00Z")-new Date(b+"T00:00:00Z"))<=2*86400000}
function uniq(a){return[...new Set((a||[]).filter(Boolean).map(String))]}
function titles(a){return uniq(a).slice(0,50)}
async function tmdb(id,path=""){return(await fetchJson(`https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}${path}${path.includes("?")?"&":"?"}api_key=${encodeURIComponent(TMDB_KEY)}`,7000)).data}
async function external(id){return(await fetchJson(`https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}/external_ids?api_key=${encodeURIComponent(TMDB_KEY)}`,7000)).data}
async function arm(id,imdb,tvdb){const urls=[imdb&&`https://arm.haglund.dev/api/v2/imdb?id=${encodeURIComponent(imdb)}`,id&&`https://arm.haglund.dev/api/v2/themoviedb?id=${encodeURIComponent(id)}`,tvdb&&`https://arm.haglund.dev/api/v2/thetvdb?id=${encodeURIComponent(tvdb)}`].filter(Boolean);const rs=await Promise.all(urls.map(u=>fetchJson(u,5000)));const ids=[],states=[];for(const r of rs){states.push(r.state);if(r.state==="HIT"&&Array.isArray(r.data))for(const x of r.data)if(x&&x.myanimelist)ids.push(String(x.myanimelist))}return{ids:uniq(ids),states}}
async function aniTmdb(id,imdb){return(await fetchJson(id?`https://api.ani.zip/mappings?themoviedb_id=${encodeURIComponent(id)}`:`https://api.ani.zip/mappings?imdb_id=${encodeURIComponent(imdb)}`,5000)).data}
async function aniMal(mal){return(await fetchJson(`https://api.ani.zip/mappings?mal_id=${encodeURIComponent(mal)}`,5000)).data}
async function jikan(mal){return(await fetchJson(`https://api.jikan.moe/v4/anime/${encodeURIComponent(mal)}`,5000)).data}
function aniIds(x){return x&&x.mappings&&x.mappings.mal_id?[String(x.mappings.mal_id)]:[]}
async function eligibility(id,old,ext){
if(old&&old.animeEligible===true&&old.mal_id)return{ok:true,mal:old.mal_id,imdb:old.imdb_id||ext&&ext.imdb_id||null,source:"stored"};
if(old&&old.animeEligible===false&&old.animeEligibilityReason==="NO_ANIME_SOURCE")return{ok:false,temporary:false,imdb:old.imdb_id||ext&&ext.imdb_id||null,source:"NO_ANIME_SOURCE"};
const imdb=String(old&&old.imdb_id||ext&&ext.imdb_id||"")||null,states=[],candidates=[];
const[ar,az]=await Promise.all([arm(id,imdb,ext&&ext.tvdb_id),aniTmdb(id,imdb)]);
if(ar.ids.length){candidates.push(...ar.ids);states.push("HIT")}else states.push(...ar.states.length?ar.states:["MISS"]);
const azIds=aniIds(az);
if(azIds.length)candidates.push(...azIds);else states.push("MISS");
if(ar.ids.length){states.push("SKIPPED_ARM_HIT");log(`ELIGIBILITY MAL=HIT ARM=HIT JIKAN=SKIPPED -> ANIME CONFIRMED`);return{ok:true,mal:ar.ids[0],imdb,source:"ARM"}}
let mal=null,jikanState="MISS";
const jikCands=uniq(candidates).slice(0,3);
if(jikCands.length){
const rs=await Promise.allSettled(jikCands.map(m=>jikan(m)));
for(const r of rs){
if(r.status==="fulfilled"&&r.value&&r.value.data&&r.value.data.mal_id){mal=String(r.value.data.mal_id);jikanState="HIT";break}
if(r.status==="fulfilled"&&r.value===null)jikanState="HTTP_ERROR"
}
}
states.push(jikanState);
if(mal){log(`ELIGIBILITY MAL=HIT ARM=MISS JIKAN=HIT -> ANIME CONFIRMED`);return{ok:true,mal,imdb,source:"JIKAN"}}
const genuine=states.filter(x=>x==="MISS").length===states.length;
log(`ELIGIBILITY MAL=MISS ARM=MISS JIKAN=${jikanState} -> ${genuine?"NO_ANIME_SOURCE":"TEMPORARY_SOURCE_FAILURE"}`);
return{ok:false,temporary:!genuine,imdb,source:genuine?"NO_ANIME_SOURCE":"TEMPORARY_SOURCE_FAILURE"}
}
async function readSeries(s,id){const x=await s.get(`anime:${id}`,{type:"json",consistency:"eventual"});return x&&typeof x==="object"?x:null}
async function readSeason(s,id,n){const x=await s.get(`anime:${id}:season:${n}`,{type:"json",consistency:"eventual"});return x&&typeof x==="object"?x:null}
function mapping(record,seasonNo,episode){const ss=record&&record.seasons&&record.seasons[String(seasonNo)],e=ss&&ss.episodes&&ss.episodes[String(episode)];if(!e||e.mal_episode==null)return null;return{tmdb_id:record.tmdb_id,imdb_id:record.imdb_id||null,mal_id:record.mal_id||null,anime_title:record.title||"",titles:record.titles||[],season:Number(seasonNo),episode:Number(episode),mal_episode:Number(e.mal_episode),air_date:e.air_date||"",season_title:ss.title||"",source:"lazy-db"}}
async function lookup(id,s,e){const st=db(),ss=await readSeason(st,id,s);if(ss&&ss.episodes&&ss.episodes[String(e)]&&ss.episodes[String(e)].mal_episode!=null){const p=await readSeries(st,id)||{tmdb_id:id};const m=mapping(Object.assign({},p,{seasons:{[String(s)]:ss}}),s,e);if(m){log(`DB HIT SEASON TMDB=${id} S${s}E${e}`);return m}}const legacy=await readSeries(st,id),m=mapping(legacy,s,e);log(m?`DB HIT LEGACY TMDB=${id} S${s}E${e}`:`DB MISS TMDB=${id} S${s}E${e}`);return m}
async function lock(st,id){const k=`building:${id}`,now=Date.now(),old=await st.get(k,{type:"json",consistency:"eventual"});if(old&&Number(old.expiresAt)>now){log(`LOCK COLLISION TMDB=${id}`);return false}if(old)try{await st.delete(k)}catch(e){}const r=await st.setJSON(k,{tmdb_id:id,startedAt:now,expiresAt:now+LOCK_TTL},{onlyIfNew:true});if(r&&r.modified){log(`LOCK ACQUIRED TMDB=${id}`);return true}log(`LOCK COLLISION TMDB=${id}`);return false}
async function unlock(st,id){try{await st.delete(`building:${id}`);log(`LOCK RELEASED TMDB=${id}`)}catch(e){log(`LOCK RELEASE FAILED TMDB=${id}`)}}
function through(total,episodes){let n=0;while(n<total&&episodes&&episodes[String(n+1)]&&episodes[String(n+1)].mal_episode!=null)n++;return n}
async function shinkro(id,s,e){const r=await fetchJson(`${SHINKRO_URL}?tmdbId=${encodeURIComponent(id)}&season=${s}&episode=${e}`,7000);return r.state==="HIT"&&r.data&&r.data.ok&&r.data.mapping?r.data.mapping:null}

async function populateWindow(id,s,start,end,seed,parent,oldSeason){
const ext=await external(id),el=await eligibility(id,parent,ext);
if(!el.ok){
if(!el.temporary){
const st=db(),next=Object.assign({},parent||{},{tmdb_id:id,imdb_id:el.imdb,animeEligible:false,animeEligibilityReason:"NO_ANIME_SOURCE",checkedAt:Date.now(),updatedAt:Date.now()});
await st.setJSON(`anime:${id}`,next);
log(`NO-ANIME STORED TMDB=${id}`)
}
return{eligible:false,temporary:el.temporary}
}
const series=await tmdb(id);
if(!series)throw new Error(`TMDB series ${id} unavailable`);
const ani=await aniTmdb(id,el.imdb);
if(!ani||!ani.episodes)throw new Error(`ani.zip has no episodes for TMDB ${id}`);
const byCoord={};
const seasonSet=new Set();
const seasonCounts={};
for(const e of Object.values(ani.episodes)){
const sn=Number(e.seasonNumber),en=Number(e.episodeNumber);
if(!Number.isInteger(sn)||!Number.isInteger(en))continue;
seasonSet.add(sn);
seasonCounts[sn]=(seasonCounts[sn]||0)+1;
byCoord[`${sn}:${en}`]={
tvdb_episode_id:e.tvdbId||null,
air_date:day(e.airDateUtc||e.airDate||e.airdate),
title:(e.title&&(e.title.en||e.title.x))||""
};
}
const seasonList=[...seasonSet].sort((a,b)=>a-b);
log(`ANI.ZIP TMDB=${id} episodes=${Object.keys(byCoord).length} seasons=${seasonList.join(",")||"none"} totalForS${s}=${seasonCounts[s]||0}`);
const oldEpisodes=oldSeason&&oldSeason.episodes||{};
const total=Math.max(Number(seasonCounts[s]||0),Number(oldSeason&&oldSeason.totalEpisodes||0),end);
const needed=[];
for(let n=Math.max(1,start);n<=end;n++)if(!oldEpisodes[String(n)]||oldEpisodes[String(n)].mal_episode==null)needed.push(n);
log(`WINDOW TMDB=${id} S${s} total=${total} range=${start}-${end} existing=${Object.keys(oldEpisodes).length} missing=${needed.length}`);
if(!needed.length){
const sState=oldSeason||{tmdb_id:id,totalEpisodes:total,episodes:oldEpisodes,mappedThrough:through(total,oldEpisodes),complete:through(total,oldEpisodes)>=total};
return{eligible:true,seasonState:sState,mapped:0,failed:0}
}
const malIds=uniq([el.mal,...aniIds(ani)]);
const aniEps=new Map();
await Promise.all(malIds.slice(0,5).map(async mal=>{
try{
const a=await aniMal(mal),eps=a&&a.episodes?Object.values(a.episodes).map(x=>({episode:Number(x.episode),date:x.airDateUtc||x.airDate||x.airdate})).filter(x=>Number.isInteger(x.episode)&&x.episode>0):[];
aniEps.set(String(mal),eps);
log(`ANI.MAL MAL=${mal} episodes=${eps.length}`)
}catch(e){aniEps.set(String(mal),[])}
}));
const added={};
const unresolved=[];
for(const ep of needed){
const entry=byCoord[`${s}:${ep}`];
if(!entry){unresolved.push(ep);continue}
if(!entry.air_date){log(`ANI.ZIP NO AIRDATE S${s}E${ep}`);unresolved.push(ep);continue}
let matched=null;
for(const id2 of malIds.slice(0,5)){
const eps=aniEps.get(String(id2))||[];
const matches=eps.filter(x=>dateMatch(x.date,entry.air_date)).sort((x,y)=>x.episode-y.episode);
if(matches.length){matched={mal_id:String(id2),mal_episode:matches[0].episode};break}
}
if(!matched){log(`ANI.ZIP NO MAL MATCH S${s}E${ep} air=${entry.air_date}`);unresolved.push(ep);continue}
added[String(ep)]={title:entry.title,air_date:entry.air_date,mal_id:matched.mal_id,mal_episode:matched.mal_episode,tvdb_episode_id:entry.tvdb_episode_id,updatedAt:Date.now()};
}
const stillUnresolved=[];
for(let i=0;i<unresolved.length;i+=CONCURRENCY){
const batch=unresolved.slice(i,i+CONCURRENCY);
const shResults=await Promise.all(batch.map(async ep=>{try{return{ep,sh:await shinkro(id,s,ep)}}catch(e){return{ep,sh:null}}}));
for(const{ep,sh} of shResults){
if(sh&&sh.mal_episode!=null){
added[String(ep)]={title:"",air_date:"",mal_id:String(sh.mal_id||el.mal),mal_episode:Number(sh.mal_episode),updatedAt:Date.now()};
log(`SHINKRO RESCUE S${s}E${ep} -> MAL E${sh.mal_episode}`)
}else{
stillUnresolved.push(ep)
}
}
}
const state=Object.assign({},oldSeason||{},{tmdb_id:id,imdb_id:el.imdb,mal_id:el.mal,title:(oldSeason&&oldSeason.title)||`Season ${s}`,totalEpisodes:total,episodes:Object.assign({},oldEpisodes,added),updatedAt:Date.now()});
state.mappedThrough=through(total,state.episodes);
state.complete=state.mappedThrough>=total;
const st=db();
await st.setJSON(`anime:${id}:season:${s}`,state);
const next=Object.assign({},parent||{},{tmdb_id:id,imdb_id:el.imdb,mal_id:el.mal,title:series.name||series.original_name||seed.title||"",titles:titles([...(parent&&parent.titles||[]),series.name,series.original_name]),animeEligible:true,animeEligibilityReason:"SOURCE_CONFIRMED",updatedAt:Date.now()});
await st.setJSON(`anime:${id}`,next);
log(`WINDOW DONE TMDB=${id} S${s} range=${start}-${end} mapped=${Object.keys(added).length} failed=${stillUnresolved.length} mappedThrough=${state.mappedThrough} aniZipSeasons=${seasonList.join(",")||"none"}`);
return{eligible:true,seasonState:state,mapped:Object.keys(added).length,failed:stillUnresolved.length}
}
async function populate(seed){
const id=String(seed.tmdb_id),s=Number(seed.season),e=Number(seed.episode),st=db(),parent=await readSeries(st,id),old=await readSeason(st,id,s),current=old&&old.episodes||{},mappedThrough=Number(old&&old.mappedThrough||0),need=current[String(e)]&&current[String(e)].mal_episode!=null?[]:[e];
if(!need.length){log(`REQUESTED EPISODE ALREADY MAPPED TMDB=${id} S${s}E${e}`);return{ok:true,skipped:true,seasonState:old}}
const start=Math.max(1,e);
const end=start+MAX_WINDOW-1;
log(`POPULATE REQUEST TMDB=${id} S${s}E${e} mappedThrough=${mappedThrough} range=${start}-${end}`);
return populateWindow(id,s,start,end,seed,parent,old)
}
async function advanceBoundary(id,s,e,ss,seed,parent){
if(ss&&ss.exhausted){log(`EXHAUSTED TMDB=${id} S${s}`);return{ok:true,existing:true,boundary:true,exhausted:true,seasonState:ss}}
const total=Number(ss&&ss.totalEpisodes||0);
if(total&&e<total){
const start=Math.max(1,e+1),end=Math.min(total,start+MAX_WINDOW-1);
log(`BOUNDARY ADVANCE TMDB=${id} S${s} E${e} -> S${s}E${start}-${end}`);
const r=await populateWindow(id,s,start,end,seed,parent,ss);
return Object.assign({},r,{boundary:true,advanced:true})
}
const st=db(),now=Date.now(),seasonState=Object.assign({},ss||{},{tmdb_id:id,totalEpisodes:total,mappedThrough:Number(ss&&ss.mappedThrough||e),complete:true,exhausted:true,exhaustedAt:now,updatedAt:now});
await st.setJSON(`anime:${id}:season:${s}`,seasonState);
log(`SEASON EXHAUSTED TMDB=${id} S${s}`);
return{ok:true,existing:true,boundary:true,exhausted:true,seasonState}
}
async function populateIfNeeded(seed){
const id=String(seed.tmdb_id),s=Number(seed.season),e=Number(seed.episode),st=db(),existing=await lookup(id,s,e);
if(existing){
const ss=await readSeason(st,id,s);
if(ss&&Number(ss.mappedThrough)===e){
const locked=await lock(st,id);
if(!locked)return{ok:false,locked:true,boundary:true};
try{return await advanceBoundary(id,s,e,ss,seed,await readSeries(st,id))}finally{await unlock(st,id)}
}
return{ok:true,existing:true,boundary:false}
}
const old=await readSeason(st,id,s),locked=await lock(st,id);
if(!locked)return{ok:false,locked:true};
try{const r=await populate(seed);return Object.assign({},r,{boundary:false})}finally{await unlock(st,id)}
}
async function boundaryState(id,s,e){const st=db(),ss=await readSeason(st,id,s);if(!ss)return{boundary:false};const isBoundary=Number(ss.mappedThrough)===e;return{boundary:isBoundary,seasonComplete:!!ss.complete,totalEpisodes:Number(ss.totalEpisodes||0),mappedThrough:Number(ss.mappedThrough||0)}}
async function fallback(id,s,e){const r=await fetchJson(`${SHINKRO_URL}?tmdbId=${encodeURIComponent(id)}&season=${s}&episode=${e}`,7000);return r.state==="HIT"&&r.data&&r.data.ok?r.data.mapping:null}
exports.handler=async event=>{const method=(event.httpMethod||"GET").toUpperCase();if(method==="OPTIONS")return json(204,{});if(method!=="GET")return json(405,{ok:false,error:"Method not allowed"});try{const p=event.queryStringParameters||{},id=String(p.tmdbId||p.tmdb_id||"").trim(),s=num(p.season),e=pos(p.episode);log(`REQUEST TMDB=${id} S${p.season}E${p.episode}`);if(!/^\d+$/.test(id)||id.length>MAX_ID||s===null||!e)return json(400,{ok:false,error:"tmdbId, season and episode are required"});const m=await lookup(id,s,e);if(m)return json(200,{ok:true,source:"lazy-db",mapping:m,state:await boundaryState(id,s,e)});if(p.resolve==="1"){const st=db(),parent=await readSeries(st,id),ext=await external(id),el=await eligibility(id,parent,ext);if(!el.ok)return json(404,{ok:false,mapping:null,error:el.source,state:{animeEligible:false,temporary:!!el.temporary}});const f=await fallback(id,s,e);return f?json(200,{ok:true,source:"reference-fallback",mapping:f,state:await boundaryState(id,s,e)}):json(404,{ok:false,mapping:null,error:"Reference mapping not found",state:await boundaryState(id,s,e)})}return json(404,{ok:false,mapping:null,error:"Anime mapping not found",state:await boundaryState(id,s,e)})}catch(error){console.error("[ANIME LAZY MAPPING] FATAL",error);return json(500,{ok:false,error:error&&error.message?error.message:"Mapping service error"})}};
exports.populateIfNeeded=populateIfNeeded;
