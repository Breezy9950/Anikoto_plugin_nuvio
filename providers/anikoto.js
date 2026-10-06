/* AniKoto Nuvio provider: optimized, cached, parallel extraction. */
const ANIKOTO_URL="https://anikototv.to",AJAX_URL=ANIKOTO_URL+"/ajax",MAPPER_URL="https://mapper.nekostream.site",MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-mapping",UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36",HEADERS={"Referer":ANIKOTO_URL+"/","X-Requested-With":"XMLHttpRequest","User-Agent":UA},TIMEOUT=15000;
function log(x){console.log("[AniKoto] "+x)}
class NuvioTTLCache{constructor(){this.m=new Map()}get(k){const x=this.m.get(k);if(!x)return;if(x.e<=Date.now()){this.m.delete(k);return}return x.v}set(k,v,ttl){this.m.set(k,{v,e:Date.now()+ttl});return v}delete(k){this.m.delete(k)}}
const CACHE=globalThis.__NUVIO_PROVIDER_CACHE__||(globalThis.__NUVIO_PROVIDER_CACHE__=new NuvioTTLCache());
const MAP_TTL=86400000,SERVER_TTL=3600000,STREAM_TTL=1800000,EXTRACT_TIMEOUT=4500;
async function memo(key,ttl,fn){const hit=CACHE.get(key);if(hit!==undefined)return hit;const p=Promise.resolve().then(fn);CACHE.set(key,p,ttl);try{const v=await p;CACHE.set(key,v,ttl);return v}catch(e){CACHE.delete(key);throw e}}
async function timeout(p,ms=EXTRACT_TIMEOUT){let t;try{return await Promise.race([p,new Promise((_,r)=>t=setTimeout(()=>r(new Error("timeout")),ms))])}finally{clearTimeout(t)}}
async function settled(tasks,ms=EXTRACT_TIMEOUT){const r=await Promise.allSettled(tasks.map(x=>timeout(Promise.resolve().then(x),ms)));return r.filter(x=>x.status==="fulfilled").map(x=>x.value)}
async function req(url,opt,timeout=TIMEOUT){opt=opt||{};const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{return await fetch(url,Object.assign({},opt,{signal:c.signal}))}finally{clearTimeout(t)}}
async function text(url,opt,timeout=TIMEOUT){try{const r=await req(url,opt,timeout);if(!r.ok){log("HTTP "+r.status+" "+url);return null}return await r.text()}catch(e){log("GET failed "+url+": "+e.message);return null}}
async function json(url,opt,timeout=TIMEOUT){try{const r=await req(url,opt,timeout);if(!r.ok){log("HTTP "+r.status+" "+url);return null}return await r.json()}catch(e){log("JSON failed "+url+": "+e.message);return null}}
function attrs(s){const o={};String(s||"").replace(/([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,(_,k,a,b,c)=>{o[k.toLowerCase()]=a!==undefined?a:b!==undefined?b:c!==undefined?c:"";return _});return o}
const VOID={area:1,base:1,br:1,col:1,embed:1,hr:1,img:1,input:1,link:1,meta:1,param:1,source:1,track:1,wbr:1};
function unesc(s){return String(s||"").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)))}
function parseHTML(src){const root={tag:"root",a:{},c:[],t:""},st=[root],rx=/<[^>]+>|[^<]+/g;let m;while((m=rx.exec(String(src||"")))){const x=m[0];if(x[0]!=="<"){if(st.length)st[st.length-1].t+=unesc(x);continue}if(/^<!--/.test(x))continue;if(/^<\//.test(x)){const tag=(x.match(/^<\s*\/\s*([^\s>]+)/)||[])[1];if(tag){for(let i=st.length-1;i>0;i--)if(st[i].tag===tag.toLowerCase()){st.length=i;break}}continue}const q=x.match(/^<\s*([^\s/>]+)/);if(!q)continue;const tag=q[1].toLowerCase(),a=attrs(x.slice(q[0].length,-1)),n={tag,a,c:[],t:""};st[st.length-1].c.push(n);if(!VOID[tag]&&!/\/\s*>$/.test(x))st.push(n)}return root}
function hasClass(n,c){return (" "+(n.a.class||"").replace(/\s+/g," ")+" ").indexOf(" "+c+" ")>=0}
function match(n,sel){if(!n||n.tag==="root")return false;let tag=sel.match(/^[a-z0-9_-]+/i);if(tag&&n.tag!==tag[0].toLowerCase())return false;let id=sel.match(/#([a-z0-9_-]+)/i);if(id&&n.a.id!==id[1])return false;let cs=sel.match(/\.([a-z0-9_-]+)/gi)||[];for(const x of cs)if(!hasClass(n,x.slice(1)))return false;return true}
function all(n,sel,out){out=out||[];for(const x of n.c){if(match(x,sel))out.push(x);all(x,sel,out)}return out}
function first(n,sel){return all(n,sel,[])[0]||null}
function val(n,k){return n&&n.a[k.toLowerCase()]||""}
function nodeText(n){let s=n?n.t:"";for(const x of (n&&n.c)||[])s+=nodeText(x);return unesc(s).replace(/\s+/g," ").trim()}
function ints(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:null}
function uniq(a){return [...new Set((a||[]).filter(Boolean).map(String))]}
function norm(v){return String(v||"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g,"")}
function clean(v){return typeof v==="string"?v.replace(/\\/g,""):v}

async function getMapping(id,s,e){return memo("anikoto:mapping:"+id+":"+s+":"+e,MAP_TTL,async()=>{const u=MAPPING_URL+"?tmdbId="+encodeURIComponent(id)+"&season="+encodeURIComponent(s)+"&episode="+encodeURIComponent(e),d=await json(u,{headers:{Accept:"application/json","User-Agent":UA}},3000);if(!d||!d.ok||!d.mapping)return null;const m=d.mapping,mal=String(m.mal_id||m.malId||"").trim(),ep=ints(m.mal_episode||m.target_episode);return mal&&ep?{malId:mal,malEpisode:ep,title:String(m.anime_title||"").trim(),titles:Array.isArray(m.titles)?m.titles.filter(Boolean).map(String):[]}:null})}

const LAZY_MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping",POPULATE_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-populate-background",TMDB_API="https://api.themoviedb.org/3",TMDB_KEY="68e094699525b18a70bab2f86b1fa706";
async function lazyMapping(id,s,e){try{const u=LAZY_MAPPING_URL+"?tmdb_id="+encodeURIComponent(id)+"&tmdbId="+encodeURIComponent(id)+"&season="+s+"&episode="+e,d=await json(u,{headers:{Accept:"application/json","User-Agent":UA}},2500);if(!d||!d.ok||!d.mapping)return null;const m=d.mapping,mal=String(m.mal_id||m.malId||"").trim(),ep=ints(m.mal_episode||m.target_episode);return mal&&ep?{malId:mal,malEpisode:ep,title:String(m.anime_title||m.title||"").trim(),titles:Array.isArray(m.titles)?m.titles.filter(Boolean).map(String):[],source:"lazy"}:null}catch(e){return null}}
function triggerPopulation(seed){if(!seed||!seed.tmdb_id)return;try{void fetch(POPULATE_URL,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json","User-Agent":UA},body:JSON.stringify(seed)}).catch(()=>{})}catch(e){}}
function pollLazyMapping(id,s,e,maxWait){
  const delays=[250,500,1000,1500,2000];
  const start=Date.now();
  return new Promise(resolve=>{
    let i=0;
    const attempt=()=>{
      if(i>=delays.length)return resolve(null);
      if(Date.now()-start>=maxWait)return resolve(null);
      const d=delays[i++];
      setTimeout(()=>{
        if(Date.now()-start>=maxWait)return resolve(null);
        lazyMapping(id,s,e).then(r=>{
          if(r&&r.malId&&r.malEpisode)return resolve(r);
          attempt()
        }).catch(()=>attempt())
      },d)
    };
    attempt()
  })
}
async function resolveTmdbId(id,type){id=String(id||"").trim();if(/^\d+$/.test(id)||!/^tt\d+$/i.test(id))return id;try{const t=String(type||"tv").toLowerCase()==="movie"?"movie_results":"tv_results",d=await json(TMDB_API+"/find/"+encodeURIComponent(id)+"?api_key="+encodeURIComponent(TMDB_KEY)+"&external_source=imdb_id",{headers:{"Accept":"application/json","User-Agent":UA}},2500);const a=d&&Array.isArray(d[t])?d[t]:[];return a[0]&&a[0].id?String(a[0].id):id}catch(e){return id}}
async function tmdbInfo(id,type){try{const t=String(type||"tv").toLowerCase()==="movie"?"movie":"tv",d=await json(TMDB_API+"/"+t+"/"+encodeURIComponent(id)+"?api_key="+encodeURIComponent(TMDB_KEY)+"&language=en-US",{headers:{"Accept":"application/json","User-Agent":UA}},2500);if(!d)return null;return{title:String(d.name||d.title||d.original_name||d.original_title||"").trim(),originalTitle:String(d.original_name||d.original_title||"").trim()}}catch(e){return null}}
async function resolveMap(id,s,e){const lazy=await lazyMapping(id,s,e);if(lazy){log("Lazy mapper HIT TMDB="+id+" S"+s+"E"+e+" -> MAL="+lazy.malId+" E"+lazy.malEpisode);return lazy}const shinkro=await getMapping(id,s,e);if(shinkro){log("Shinkro mapper HIT TMDB="+id+" S"+s+"E"+e+" -> MAL="+shinkro.malId+" E"+shinkro.malEpisode);return shinkro}return null}

async function searchAnime(q){if(!q)return[];return memo("anikoto:search:"+String(q).toLowerCase(),MAP_TTL,async()=>{const d=await json(AJAX_URL+"/anime/search?keyword="+encodeURIComponent(q),{headers:HEADERS});const h=d&&d.result&&d.result.html;if(!h)return[];const root=parseHTML(h),box=first(root,"div.scaff.items"),out=[];if(!box)return out;for(const n of box.c){if(!n.a||!n.a.href)continue;const t=first(n,".name.d-title");if(t)out.push({title:nodeText(t),url:new URL(n.a.href,ANIKOTO_URL).href,image:(first(n,"img")||{a:{}}).a.src||""})}return out})}

function rank(rs,titles){const ts=uniq(titles).map(norm).filter(Boolean);return rs.slice().sort((a,b)=>{const sc=x=>{const t=norm(x.title);if(ts.indexOf(t)>=0)return 100;if(ts.some(y=>t.indexOf(y)>=0||y.indexOf(t)>=0))return 80;return 0};return sc(b)-sc(a)})}

async function episodes(animeUrl){return memo("anikoto:episodes:"+animeUrl,SERVER_TTL,async()=>{const h=await text(animeUrl,{headers:HEADERS});if(!h)return null;const r=parseHTML(h),w=first(r,"#watch-main"),id=w&&val(w,"data-id");if(!id)return null;const d=await json(AJAX_URL+"/episode/list/"+encodeURIComponent(id)+"?vrf=",{headers:HEADERS});const eh=d&&d.result;if(!eh)return null;const er=parseHTML(eh),out=[];for(const a of all(er,"a")){const id=val(a,"data-ids"),num=ints(val(a,"data-num"));if(!num)continue;out.push({episodeId:id,href:val(a,"href"),malId:val(a,"data-mal")||null,episodeNumber:num,title:val(a,"title"),dub:val(a,"data-dub")==="1",filler:hasClass(a,"filler")})}return out})}

async function findEpisode(m){const qs=uniq([m.title,...m.titles]),allr=[];const searchResults=await settled(qs.map(q=>()=>searchAnime(q)),EXTRACT_TIMEOUT);for(const r of searchResults)for(const x of r||[])if(!allr.some(y=>y.url===x.url))allr.push(x);const candidates=rank(allr,qs).slice(0,10),checks=await settled(candidates.map(c=>async()=>{const es=await episodes(c.url);if(!es)return null;const e=es.find(x=>(m.malId?x.malId===m.malId&&x.episodeNumber===m.malEpisode:x.episodeNumber===m.malEpisode)&&x.episodeId);return e?{candidate:c,episode:e,episodes:es}:null}),EXTRACT_TIMEOUT);return checks.find(Boolean)||null}

async function kiwi(mal,ep){const u=MAPPER_URL+"/api/mal/"+encodeURIComponent(mal)+"/"+encodeURIComponent(ep)+"/"+Math.floor(Date.now()/1000),d=await json(u,{headers:HEADERS});return d&&d["Kiwi-Stream-"]||null}

async function serverLinks(id,dub){return memo("anikoto:servers:"+id+":"+(dub?1:0),SERVER_TTL,async()=>{const d=await json(AJAX_URL+"/server/list?servers="+encodeURIComponent(id),{headers:HEADERS}),h=d&&d.result;if(!h)return[];const r=parseHTML(h),out=[];for(const g of all(r,"div.servers")){const types=all(g,"div.type");for(const t of types){if((val(t,"data-type")==="dub")!==dub)continue;for(const x of all(t,"li")){const link=val(x,"data-link-id");if(link)out.push({name:nodeText(x)||"Unknown",linkId:link,groupName:nodeText(t).replace(nodeText(x),"").trim()})}}}return out})}

async function serverUrl(id){return memo("anikoto:serverurl:"+id,SERVER_TTL,async()=>{const d=await json(AJAX_URL+"/server?get="+encodeURIComponent(id),{headers:HEADERS},EXTRACT_TIMEOUT);return d&&d.result&&d.result.url?String(d.result.url).trim():null})}

function b64dec(s){s=String(s||"").replace(/-/g,"+").replace(/_/g,"/");s+=Array((4-s.length%4)%4+1).join("=");const abc="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",o=[];let bits=0,v=0;for(let i=0;i<s.length;i++){const c=s.charAt(i);if(c==="=")break;const n=abc.indexOf(c);if(n<0)continue;v=(v<<6)|n;bits+=6;if(bits>=8){bits-=8;o.push((v>>bits)&255)}}return new Uint8Array(o)}
function utf8(a){let s="";for(let i=0;i<a.length;){const c=a[i++];if(c<128)s+=String.fromCharCode(c);else if(c<224)s+=String.fromCharCode(((c&31)<<6)|(a[i++]&63));else if(c<240)s+=String.fromCharCode(((c&15)<<12)|((a[i++]&63)<<6)|(a[i++]&63));else{const cp=((c&7)<<18)|((a[i++]&63)<<12)|((a[i++]&63)<<6)|(a[i++]&63);const z=cp-65536;s+=String.fromCharCode(55296+(z>>10),56320+(z&1023))}}return s}
function b64url(a){const abc="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",u=a instanceof Uint8Array?a:new Uint8Array(a),o=[];for(let i=0;i<u.length;i+=3){const x=u[i],y=i+1<u.length?u[i+1]:0,z=i+2<u.length?u[i+2]:0;o.push(abc[x>>2],abc[((x&3)<<4)|(y>>4)],i+1<u.length?abc[((y&15)<<2)|(z>>6)]:"=",i+2<u.length?abc[z&63]:"=")}return o.join("").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}

const AES_SBOX=[99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22];
const AES_ISBOX=[82,9,106,213,48,54,165,56,191,64,163,158,129,243,215,251,124,227,57,130,155,47,255,135,52,142,67,68,196,222,233,203,84,123,148,50,166,194,35,61,238,76,149,11,66,250,195,78,8,46,161,102,40,217,36,178,118,91,162,73,109,139,209,37,114,248,246,100,134,104,152,22,212,164,92,204,93,101,182,146,108,112,72,80,253,237,185,218,94,21,70,87,167,141,157,132,144,216,171,0,140,188,211,10,247,228,88,5,184,179,69,6,208,44,30,143,202,63,15,2,193,175,189,3,1,19,138,107,58,145,17,65,79,103,220,234,151,242,207,206,240,180,230,115,150,172,116,34,231,173,53,133,226,249,55,232,28,117,223,110,71,241,26,113,29,41,197,137,111,183,98,14,170,24,190,27,252,86,62,75,198,210,121,32,154,219,192,254,120,205,90,244,31,221,168,51,136,7,199,49,177,18,16,89,39,128,236,95,96,81,127,169,25,181,74,13,45,229,122,159,147,201,156,239,160,224,59,77,174,42,245,176,200,235,187,60,131,83,153,97,23,43,4,126,186,119,214,38,225,105,20,99,85,33,12,125];
const AES_RCON=[0,1,2,4,8,16,32,64,128,27,54,108,216,171,77];
function aesX(a,b){let r=0;for(let i=0;i<8;i++){if(b&1)r^=a;const h=a&128;a=(a<<1)&255;if(h)a^=27;b>>=1}return r}
function aesKey(key){const k=new Uint8Array(240);k.set(key);const bytes=key.length;let i=bytes,temp=new Uint8Array(4),r=1;while(i<240){for(let j=0;j<4;j++)temp[j]=k[i-4+j];if(i%bytes===0){const t=temp[0];temp[0]=AES_SBOX[temp[1]];temp[1]=AES_SBOX[temp[2]];temp[2]=AES_SBOX[temp[3]];temp[3]=AES_SBOX[t];temp[0]^=AES_RCON[r++]}else if(bytes===32&&i%bytes===16){for(let j=0;j<4;j++)temp[j]=AES_SBOX[temp[j]]}for(let j=0;j<4;j++){k[i]=k[i-bytes]^temp[j];i++}}return k}
function aesAdd(s,k,r){const o=r*16;for(let i=0;i<16;i++)s[i]^=k[o+i]}
function aesInvShift(s){const t=s.slice();for(let r=0;r<4;r++)for(let c=0;c<4;c++)s[4*c+r]=t[4*((c-r+4)%4)+r]}
function aesInvSub(s){for(let i=0;i<16;i++)s[i]=AES_ISBOX[s[i]]}
function aesInvMix(s){for(let c=0;c<4;c++){const i=4*c,a=s[i],b=s[i+1],d=s[i+2],e=s[i+3];s[i]=aesX(a,14)^aesX(b,11)^aesX(d,13)^aesX(e,9);s[i+1]=aesX(a,9)^aesX(b,14)^aesX(d,11)^aesX(e,13);s[i+2]=aesX(a,13)^aesX(b,9)^aesX(d,14)^aesX(e,11);s[i+3]=aesX(a,11)^aesX(b,13)^aesX(d,9)^aesX(e,14)}}
function aesDecBlock(block,key){const s=new Uint8Array(block),k=aesKey(key),nr=key.length===16?10:14;aesAdd(s,k,nr);aesInvShift(s);aesInvSub(s);for(let r=nr-1;r>0;r--){aesAdd(s,k,r);aesInvMix(s);aesInvShift(s);aesInvSub(s)}aesAdd(s,k,0);return s}
function aesCbcDec(data,key,iv){if(data.length%16)throw new Error("Invalid AES ciphertext");const o=new Uint8Array(data.length);let prev=iv.slice();for(let p=0;p<data.length;p+=16){const b=aesDecBlock(data.slice(p,p+16),key);for(let i=0
