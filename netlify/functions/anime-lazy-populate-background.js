const{populateIfNeeded}=require("./anime-lazy-mapping.js");
function log(x){console.log(`[ANIME LAZY BG] ${x}`)}
function body(event){try{return JSON.parse(event&&event.body||"{}")}catch(e){return null}}
const POPULATE_DEADLINE_MS=90000;
exports.handler=async event=>{
const seed=body(event);
if(!seed){log("INVALID JSON BODY");return{statusCode:400,body:JSON.stringify({ok:false,error:"Invalid JSON body"})}}
try{
const id=String(seed.tmdb_id||"").trim(),season=Number(seed.season),episode=Number(seed.episode),malEpisode=seed.mal_episode==null?null:Number(seed.mal_episode);
if(!/^\d+$/.test(id)||id.length>50||!Number.isInteger(season)||season<0||!Number.isInteger(episode)||episode<1||episode>100000||(malEpisode!==null&&(!Number.isInteger(malEpisode)||malEpisode<1||malEpisode>100000))){
log(`INVALID SEED TMDB=${id||"?"} S${seed.season??"?"}E${seed.episode??"?"}`);
return{statusCode:400,body:JSON.stringify({ok:false,error:"Invalid population seed"})}
}
log(`START TMDB=${id} S${season}E${episode}`);
let timer=null;
const timeoutPromise=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("populate timeout")),POPULATE_DEADLINE_MS)});
let result;
try{
result=await Promise.race([populateIfNeeded(Object.assign({},seed,{tmdb_id:id,season,episode,mal_episode:malEpisode})),timeoutPromise]);
}finally{
if(timer!==null)clearTimeout(timer);
}
const populationOk=!!(result&&(
result.ok===true||
(result.seasonState&&Number(result.mapped||0)>=0&&Number(result.failed||0)===0)||
(result.existing===true)
));
log(`COMPLETE TMDB=${id} S${season}E${episode} ok=${populationOk} skipped=${!!(result&&result.skipped)} locked=${!!(result&&result.locked)} boundary=${!!(result&&result.boundary)} exhausted=${!!(result&&result.exhausted)} mapped=${Number(result&&result.mapped||0)} failed=${Number(result&&result.failed||0)}`);
return{statusCode:200,body:JSON.stringify({ok:true,result:{ok:populationOk,skipped:!!(result&&result.skipped),locked:!!(result&&result.locked),boundary:!!(result&&result.boundary),exhausted:!!(result&&result.exhausted),mapped:Number(result&&result.mapped||0),failed:Number(result&&result.failed||0),seasonState:result&&result.seasonState||null}})}
}catch(error){
console.error("[ANIME LAZY BG] FAILED",error&&error.stack||error);
const msg=error&&error.message?error.message:"Background population failed";
return{statusCode:500,body:JSON.stringify({ok:false,error:msg})}
}
};
