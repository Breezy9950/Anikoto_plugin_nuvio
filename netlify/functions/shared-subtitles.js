const {getStore}=require("@netlify/blobs");
const STORE_NAME="shared-subtitles-v1";
const PUBLISHERS={lee:"Lee",anizone:"AniZone",reanime:"Reanime",vidnest:"VidNest"};
const MAX_TRACKS=40,MAX_URL=4096,MAX_NAME=120,MAX_LANGUAGE=40;
function response(status,body){return{statusCode:status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Accept"},body:JSON.stringify(body)}}
function store(){return getStore({name:STORE_NAME,siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN})}
function cleanText(v,max){return String(v==null?"":v).trim().slice(0,max)}
function identity(q){
 const tmdb=cleanText(q.tmdb_id||q.tmdbId,20),type=String(q.media_type||q.mediaType||"tv").toLowerCase();
 if(!/^\d+$/.test(tmdb)||Number(tmdb)<=0)return null;
 if(type!=="tv"&&type!=="movie")return null;
 const season=Number(q.season),episode=Number(q.episode);
 if(type==="tv"&&(!Number.isInteger(season)||season<0||season>1000||!Number.isInteger(episode)||episode<1||episode>100000))return null;
 return{tmdb_id:tmdb,media_type:type,season:type==="tv"?season:0,episode:type==="tv"?episode:0};
}
function sourceKey(i,source){return`subtitle:v1:${i.media_type}:${i.tmdb_id}:${i.season}:${i.episode}:source:${String(source).toLowerCase()}`}
function hash(s){let h1=0xdeadbeef^s.length,h2=0x41c6ce57^s.length;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return(h2>>>0).toString(36)+(h1>>>0).toString(36)}
function normalizeTrack(raw,source){
 const url=cleanText(raw&& (raw.url||raw.file||raw.src),MAX_URL);
 if(!/^https:\/\//i.test(url))return null;
 let u;try{u=new URL(url)}catch(e){return null}if(!u.hostname||u.username||u.password)return null;
 const language=cleanText(raw.language||raw.lang||raw.srclang||"Unknown",MAX_LANGUAGE)||"Unknown";
 const name=cleanText(raw.name||raw.label||raw.title||language,MAX_NAME)||language;
 let format=cleanText(raw.format||raw.subtitleFormat||"",10).toLowerCase().replace(/^\./,"");
 if(!["vtt","srt","ass","ssa","ttml","dfxp"].includes(format)){const m=u.pathname.toLowerCase().match(/\.(vtt|srt|ass|ssa|ttml|dfxp)$/);format=m?m[1]:"vtt"}
 return{url,language,name,format,sourceProvider:source,updatedAt:Date.now()};
}
async function readAll(st,i){
 const sources=Object.values(PUBLISHERS);
 const records=await Promise.all(sources.map(async source=>{
  try{const value=await st.get(sourceKey(i,source),{type:"json",consistency:"strong"});return Array.isArray(value)?value:[]}catch(e){return[]}
 }));
 const seen=new Set(),out=[];
 for(const list of records)for(const x of list){
  if(!x||!x.url||!x.sourceProvider)continue;
  const k=x.url+"\n"+String(x.language||"").toLowerCase();if(seen.has(k))continue;seen.add(k);out.push(x)
 }
 out.sort((a,b)=>String(a.sourceProvider).localeCompare(String(b.sourceProvider))||String(a.language).localeCompare(String(b.language)));
 return out;
}
exports.handler=async(event)=>{
 if(event.httpMethod==="OPTIONS")return response(200,{ok:true});
 if(event.httpMethod==="GET"){
  const i=identity(event.queryStringParameters||{});if(!i)return response(400,{ok:false,error:"Invalid subtitle identity; require numeric tmdb_id, media_type and valid TV season/episode."});
  try{const subtitles=await readAll(store(),i);return response(200,{ok:true,identity:i,subtitles})}catch(e){console.error("[SHARED SUBTITLES] Read failed",e&&e.message||e);return response(503,{ok:false,error:"Subtitle store unavailable"})}
 }
 if(event.httpMethod==="POST"){
  let body;try{body=JSON.parse(event.body||"{}")}catch(e){return response(400,{ok:false,error:"Request body must be valid JSON."})}
  const i=identity(body);if(!i)return response(400,{ok:false,error:"Invalid subtitle identity."});
  const rawProvider=cleanText(body.provider,40).toLowerCase(),source=PUBLISHERS[rawProvider];
  if(!source)return response(403,{ok:false,error:"This provider is not authorized to publish shared subtitles."});
  if(!Array.isArray(body.subtitles)||body.subtitles.length===0)return response(400,{ok:false,error:"subtitles must be a non-empty array."});
  if(body.subtitles.length>MAX_TRACKS)return response(413,{ok:false,error:`At most ${MAX_TRACKS} subtitle tracks may be submitted at once.`});
  const tracks=body.subtitles.map(x=>normalizeTrack(x,source)).filter(Boolean);
  if(!tracks.length)return response(400,{ok:false,error:"No valid HTTPS subtitle URLs were supplied."});
  try{
   const st=store(),key=sourceKey(i,source);
   const existing=await st.get(key,{type:"json",consistency:"strong"}).catch(()=>[]);
   const merged=Array.isArray(existing)?existing.slice():[];
   const seen=new Set(merged.map(t=>String(t.url||"")+"\n"+String(t.language||"").toLowerCase()));
   for(const t of tracks){const dedupe=t.url+"\n"+t.language.toLowerCase();if(seen.has(dedupe))continue;seen.add(dedupe);merged.push({...i,...t})}
   await st.setJSON(key,merged);
   return response(200,{ok:true,stored:tracks.length,unique:merged.length,provider:source,identity:i});
  }catch(e){console.error("[SHARED SUBTITLES] Write failed",e&&e.message||e);return response(503,{ok:false,error:"Subtitle store unavailable"})}
 }
 return response(405,{ok:false,error:"Method not allowed"});
};
