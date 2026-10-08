/*
 * Anikoto — native Nuvio provider.
 * Mapper access is STRICTLY READ-ONLY. This provider never populates or writes mappings.
 * Stream extraction is ported from AnimeStream's Anikoto/MegaPlay/VidTube implementations.
 */
const BASE="https://anikototv.to";
const AJAX=BASE+"/ajax";
const MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping";
const UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";
const HEADERS={
  "User-Agent":UA,
  "Referer":BASE+"/",
  "X-Requested-With":"XMLHttpRequest",
  "Accept":"*/*"
};
const MAPPING_HEADERS={"User-Agent":UA,"Accept":"application/json"};
const REQUEST_TIMEOUT=6000;
const SERVER_TIMEOUT=4500;
const EXTRACT_TIMEOUT=5500;

function log(x){console.log("[Anikoto] "+x)}

class TTLCache{
  constructor(){this.m=new Map()}
  get(k){const x=this.m.get(k);if(!x)return undefined;if(x.e<=Date.now()){this.m.delete(k);return undefined}return x.v}
  set(k,v,ttl){this.m.set(k,{v,e:Date.now()+ttl});return v}
  delete(k){this.m.delete(k)}
}
const CACHE=globalThis.__NUVIO_ANIKOTO_CACHE__||(globalThis.__NUVIO_ANIKOTO_CACHE__=new TTLCache());

async function req(url,opt={},ms=REQUEST_TIMEOUT){
  const o={...opt,headers:{...HEADERS,...(opt.headers||{})}};
  if(typeof AbortController!=="function"){
    try{return await fetch(url,o)}catch(e){return null}
  }
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  try{return await fetch(url,{...o,signal:c.signal})}
  catch(e){return null}
  finally{clearTimeout(t)}
}
async function json(url,opt={},ms=REQUEST_TIMEOUT){
  try{
    const r=await req(url,opt,ms);
    if(!r||!r.ok)return null;
    return await r.json()
  }catch(e){return null}
}
async function text(url,opt={},ms=REQUEST_TIMEOUT){
  try{
    const r=await req(url,opt,ms);
    if(!r||!r.ok)return"";
    return await r.text()
  }catch(e){return""}
}
async function settle(tasks){
  const rs=await Promise.allSettled(tasks.map(fn=>Promise.resolve().then(fn)));
  return rs.filter(x=>x.status==="fulfilled").map(x=>x.value).filter(Boolean)
}
async function timeout(p,ms){
  let t;
  try{return await Promise.race([p,new Promise((_,reject)=>t=setTimeout(()=>reject(new Error("timeout")),ms))])}
  finally{clearTimeout(t)}
}
async function memo(key,ttl,fn){
  const hit=CACHE.get(key);
  if(hit!==undefined)return await hit;
  const p=Promise.resolve().then(fn);
  CACHE.set(key,p,ttl);
  try{
    const v=await p;
    if(v!==null&&v!==undefined)CACHE.set(key,v,ttl);
    else CACHE.delete(key);
    return v
  }catch(e){
    CACHE.delete(key);
    throw e
  }
}

/* Minimal HTML parser used by the target repository; no DOM/browser dependency. */
function attrs(s){
  const o={};
  String(s||"").replace(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,(m,k,a,b,c)=>{
    o[k]=a!=null?a:b!=null?b:c!=null?c:"";return m
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
      const n={type:"element",name,attrs:attrs(m[2]),children:[]};
      stack[stack.length-1].children.push(n);
      if(!/\/>$/.test(full)&&!["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"].includes(name))stack.push(n)
    }
    last=re.lastIndex
  }
  if(last<src.length)stack[stack.length-1].children.push({type:"text",text:src.slice(last)});
  return root
}
function children(n){return n&&n.children||[]}
function all(root,sel){
  const out=[];
  function match(n){
    if(!n||n.type!=="element")return false;
    if(sel[0]==="#")return n.attrs.id===sel.slice(1);
    if(sel[0]==".")return String(n.attrs.class||"").split(/\s+/).includes(sel.slice(1));
    if(sel[0]==="["){
      const m=sel.match(/^\[([^=]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
      if(!m)return false;
      if(!(m[1] in n.attrs))return false;
      return m[2]==null||n.attrs[m[1]]===m[2]
    }
    return n.name===sel.toLowerCase()
  }
  function walk(n){
    if(n&&n.type==="element"&&match(n))out.push(n);
    for(const c of children(n))walk(c)
  }
  walk(root);return out
}
function first(root,sel){return all(root,sel)[0]||null}
function nodeText(n){
  if(!n)return"";
  if(n.type==="text")return n.text||"";
  return children(n).map(nodeText).join("")
}
function attr(n,k){return n&&n.attrs?n.attrs[k]:undefined}
function normalize(s){return String(s||"").toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]+/g,"").trim()}
function uniq(a){return[...new Set((a||[]).filter(Boolean).map(String))]}

/* ---------- Target mapper: READ ONLY, pending=1 prevents lazy population ---------- */
async function mapperLookup(tmdbId,season,episode){
  const key="anikoto:map:"+tmdbId+":"+season+":"+episode;
  return memo(key,300000,async()=>{
    const url=MAPPING_URL+
      "?tmdb_id="+encodeURIComponent(tmdbId)+
      "&tmdbId="+encodeURIComponent(tmdbId)+
      "&season="+encodeURIComponent(season)+
      "&episode="+encodeURIComponent(episode)+
      "&pending=1";
    const d=await json(url,{headers:MAPPING_HEADERS},5000);
    if(!d||!d.ok||!d.mapping){
      log("MAPPING MISS TMDB="+tmdbId+" S"+season+"E"+episode);
      return null
    }
    const m=d.mapping;
    const malId=String(m.mal_id||m.malId||"").trim();
    const malEpisode=Number(m.mal_episode||m.target_episode||0);
    if(!malId||!malEpisode){
      log("MAPPING INVALID TMDB="+tmdbId+" S"+season+"E"+episode);
      return null
    }
    const titles=uniq([
      m.anime_title,m.mal_title,m.mal_title_english,m.mal_title_romanji,
      ...(Array.isArray(m.titles)?m.titles:[])
    ]);
    const result={
      malId,malEpisode,
      title:String(m.anime_title||m.mal_title||"").trim(),
      titles,
      imdbId:String(m.imdb_id||"").trim(),
      season:Number(m.season||season)||season,
      episode:Number(m.episode||episode)||episode
    };
    log("MAPPING HIT MAL="+malId+" EP="+malEpisode);
    return result
  })
}

/* ---------- Anikoto search ---------- */
async function search(query){
  query=String(query||"").trim();
  if(!query)return[];
  return memo("anikoto:search:"+normalize(query),86400000,async()=>{
    const d=await json(AJAX+"/anime/search?keyword="+encodeURIComponent(query),{headers:HEADERS},5000);
    const html=d&&d.result&&d.result.html;
    if(!html)return[];
    const root=parseHTML(html),out=[];
    const items=all(root,".items").find(n=>String(attr(n,"class")||"").split(/\s+/).includes("scaff"))||first(root,".items");
    const nodes=items?children(items):[];
    for(const item of nodes){
      if(!item||item.type!=="element")continue;
      const titleNode=first(item,".d-title");
      const title=nodeText(titleNode).trim();
      const href=attr(item,"href")||"";
      const img=attr(first(item,"img"),"src")||"";
      if(title&&href)out.push({
        name:title,
        alias:href.startsWith("http")?href:BASE+(href.startsWith("/")?href:"/"+href),
        imageUrl:img
      })
    }
    return out
  })
}
function chooseAnime(cards,m){
  const targets=uniq([m.title,...m.titles]).map(normalize).filter(Boolean);
  if(!cards.length)return null;
  let best=null,bestScore=-1;
  for(const c of cards){
    const n=normalize(c.name),titleScore=targets.includes(n)?100:targets.some(t=>n===t||n.includes(t)||t.includes(n))?70:0;
    const seasonText=String(c.name||"").toLowerCase();
    let seasonScore=0;
    if(m.season>1){
      const s=Number(m.season);
      if(new RegExp("(?:season|saison)\\s*"+s+"\\b","i").test(seasonText)||new RegExp("\\b"+s+"(?:st|nd|rd|th)?\\s*season\\b","i").test(seasonText))seasonScore=30;
      else if(new RegExp("\\b"+s+"\\b").test(seasonText))seasonScore=15
    }else{
      if(/(?:season|saison)\s*[2-9]|\b(?:2nd|3rd|4th|5th)\s*season\b|\b(?:ii|iii|iv|v)\b/i.test(seasonText))seasonScore=-25
    }
    const score=titleScore+seasonScore;
    if(score>bestScore){bestScore=score;best=c}
  }
  return bestScore>0?best:null
}
async function findAnime(m){
  const queries=uniq([m.title,...m.titles]).filter(Boolean);
  if(!queries.length)return null;
  const results=await settle(queries.slice(0,6).map(q=>()=>search(q)));
  const cards=[],seen=new Set();
  for(const rs of results)for(const c of rs||[]){
    const k=c.alias||c.name;
    if(!seen.has(k)){seen.add(k);cards.push(c)}
  }
  const best=chooseAnime(cards,m);
  if(best){
    log("ANIKOTO MATCH "+best.name);
    return best
  }
  return null
}

/* ---------- Episode/server discovery ---------- */
async function resolveEpisode(anime,m){
  const page=await text(anime.alias,{headers:HEADERS},5000);
  if(!page)return null;
  const root=parseHTML(page);
  const watch=first(root,"#watch-main");
  const id=String(attr(watch,"data-id")||"").trim();
  if(!id)return null;
  const epJson=await json(AJAX+"/episode/list/"+encodeURIComponent(id)+"?vrf=",{headers:HEADERS},5000);
  const epHtml=epJson&&epJson.result;
  if(!epHtml)return null;
  const epRoot=parseHTML(epHtml),episodes=[];
  for(const range of all(epRoot,".episodes")){
    for(const episodeNode of children(range)){
      if(!episodeNode||episodeNode.type!=="element")continue;
      const a=first(episodeNode,"a");
      if(!a)continue;
      const n=Number(attr(a,"data-num"));
      const ids=String(attr(a,"data-ids")||"").trim();
      if(Number.isInteger(n)&&n>0&&ids)episodes.push({
        episodeNumber:n,
        linkId:ids,
        hasDub:String(attr(a,"data-dub")||"").trim()==="1",
        href:attr(a,"href")||""
      })
    }
  }
  const ep=episodes.find(x=>x.episodeNumber===m.malEpisode);
  if(!ep)return null;
  log("ANIKOTO EPISODE MAL="+m.malEpisode+" LINK="+ep.linkId);
  return ep
}
async function serverList(episodeId,wantDub){
  const d=await json(AJAX+"/server/list?servers="+encodeURIComponent(episodeId),{headers:HEADERS},5000);
  const html=d&&d.result;
  if(!html)return[];
  const root=parseHTML(html),servers=[];
  for(const group of all(root,".servers")){
    const groupName=nodeText(children(group).find(x=>x&&x.type==="text"&&String(x.text||"").trim())||children(group)[0]||"").replace(/\s+/g," ").trim()||"Anikoto";
    for(const type of all(group,".type")){
      const isDub=String(attr(type,"data-type")||"").toLowerCase()==="dub";
      if(isDub!==wantDub)continue;
      const list=first(type,"ul");
      for(const item of children(list)){
        if(!item||item.type!=="element")continue;
        const linkId=String(attr(item,"data-link-id")||"").trim();
        if(!linkId)continue;
        servers.push({
          serverName:nodeText(item).replace(/\s+/g," ").trim()||"Anikoto",
          linkId,
          groupName
        })
      }
    }
  }
  return servers
}
async function resolveServer(server){
  const d=await json(AJAX+"/server?get="+encodeURIComponent(server.linkId),{headers:HEADERS},SERVER_TIMEOUT);
  const url=String(d&&d.result&&d.result.url||"").trim();
  if(!url)return null;
  return{...server,url}
}

/* ---------- Hermes-safe base64 / UTF-8 ---------- */
function b64decode(s){
  s=String(s||"").replace(/[\r\n\s]/g,"").replace(/-/g,"+").replace(/_/g,"/");
  while(s.length%4)s+="=";
  const table="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const out=[];
  for(let i=0;i<s.length;i+=4){
    const a=table.indexOf(s[i]),b=table.indexOf(s[i+1]),c=s[i+2]==="="?0:table.indexOf(s[i+2]),d=s[i+3]==="="?0:table.indexOf(s[i+3]);
    if(a<0||b<0||c<0||d<0)continue;
    out.push((a<<2)|(b>>4));
    if(s[i+2]!=="=")out.push(((b&15)<<4)|(c>>2));
    if(s[i+3]!=="=")out.push(((c&3)<<6)|d)
  }
  return new Uint8Array(out)
}
function utf8(s){
  const out=[];
  for(let i=0;i<s.length;i++){
    let c=s.charCodeAt(i);
    if(c<0x80)out.push(c);
    else if(c<0x800)out.push(0xc0|(c>>6),0x80|(c&63));
    else if(c>=0xd800&&c<=0xdbff&&i+1<s.length){
      const d=s.charCodeAt(++i),cp=0x10000+((c-0xd800)<<10)+(d-0xdc00);
      out.push(0xf0|(cp>>18),0x80|((cp>>12)&63),0x80|((cp>>6)&63),0x80|(cp&63))
    }else out.push(0xe0|(c>>12),0x80|((c>>6)&63),0x80|(c&63))
  }
  return new Uint8Array(out)
}
function bytesToString(a){
  let out="",i=0;
  while(i<a.length){
    const c=a[i++];
    if(c<128)out+=String.fromCharCode(c);
    else if(c<224)out+=String.fromCharCode(((c&31)<<6)|(a[i++]&63));
    else if(c<240)out+=String.fromCharCode(((c&15)<<12)|((a[i++]&63)<<6)|(a[i++]&63));
    else{
      const cp=(((c&7)<<18)|((a[i++]&63)<<12)|((a[i++]&63)<<6)|(a[i++]&63))-0x10000;
      out+=String.fromCharCode(0xd800+(cp>>10),0xdc00+(cp&1023))
    }
  }
  return out
}

/* ---------- AES-256-CBC + HMAC-SHA256, pure JavaScript/Hermes ---------- */
const SBOX=[
99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,
202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,
183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,
4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,
9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,
83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,
208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,
81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,
210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,
25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,
94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,
149,228,121,231,200,55,109,141,213,78,169,108,86,244,
234,101,122,174,8,186,120,37,46,28,166,180,198,232,
221,116,31,75,189,139,138,112,62,181,102,72,3,246,
14,97,53,87,185,134,193,29,158,225,248,152,17,105,
217,142,148,155,30,135,233,206,85,40,223,140,161,
137,13,191,230,66,104,65,153,45,15,176,84,187,22
];
const INV_SBOX=[
82,9,106,213,48,54,165,56,191,64,163,158,129,243,215,251,
124,227,57,130,155,47,255,135,52,142,67,68,196,222,233,203,
84,123,148,50,166,194,35,61,238,76,149,11,66,250,195,78,
8,46,161,102,40,217,36,178,118,91,162,73,109,139,209,37,
114,248,246,100,134,104,152,22,212,164,92,204,93,101,182,146,
108,112,72,80,253,237,185,218,94,21,70,87,167,141,157,132,
144,216,171,0,140,188,211,10,247,228,88,5,184,179,69,6,
208,44,30,143,202,63,15,2,193,175,189,3,1,19,138,107,
58,145,17,65,79,103,220,234,151,242,207,206,240,180,230,115,
150,172,116,34,231,173,53,133,226,249,55,232,28,117,223,110,
71,241,26,113,29,41,197,137,111,183,98,14,170,24,190,27,
252,86,62,75,198,210,121,32,154,219,192,254,120,205,90,244,
31,221,168,51,136,7,199,49,177,18,16,89,39,128,236,95,
96,81,127,169,25,181,74,13,45,229,122,159,147,201,156,239,
160,224,59,77,174,42,245,176,200,235,187,60,131,83,153,97,
23,43,4,126,186,119,214,38,225,105,20,99,85,33,12,125
];
const RCON=[0,1,2,4,8,16,32,64,128,27,54,108,216,171,77];

function xtime(a){return((a<<1)^((a&128)?0x11b:0))&255}
function mul(a,b){
  let r=0;
  while(b){if(b&1)r^=a;a=xtime(a);b>>=1}
  return r&255
}
function aesExpandKey(key){
  const w=new Uint8Array(240);w.set(key);
  let bytes=32,rcon=1;
  while(bytes<240){
    let t=[w[bytes-4],w[bytes-3],w[bytes-2],w[bytes-1]];
    if(bytes%32===0){
      t=[SBOX[t[1]],SBOX[t[2]],SBOX[t[3]],SBOX[t[0]]];
      t[0]^=rcon;rcon=xtime(rcon)
    }else if(bytes%32===16){
      t=[SBOX[t[0]],SBOX[t[1]],SBOX[t[2]],SBOX[t[3]]]
    }
    for(let i=0;i<4;i++){w[bytes]=w[bytes-32]^t[i];bytes++}
  }
  return w
}
function invShiftRows(s){
  const t=s.slice();
  for(let r=0;r<4;r++)for(let c=0;c<4;c++)s[r+4*c]=t[r+4*((c-r+4)%4)]
}
function invSubBytes(s){for(let i=0;i<16;i++)s[i]=INV_SBOX[s[i]]}
function invMixColumns(s){
  for(let c=0;c<4;c++){
    const i=4*c,a0=s[i],a1=s[i+1],a2=s[i+2],a3=s[i+3];
    s[i]=mul(a0,14)^mul(a1,11)^mul(a2,13)^mul(a3,9);
    s[i+1]=mul(a0,9)^mul(a1,14)^mul(a2,11)^mul(a3,13);
    s[i+2]=mul(a0,13)^mul(a1,9)^mul(a2,14)^mul(a3,11);
    s[i+3]=mul(a0,11)^mul(a1,13)^mul(a2,9)^mul(a3,14)
  }
}
function addRoundKey(s,key,round){
  const off=round*16;
  for(let i=0;i<16;i++)s[i]^=key[off+i]
}
function aesDecryptBlock(input,key){
  const s=new Uint8Array(input),rk=aesExpandKey(key);
  addRoundKey(s,rk,14);
  for(let round=13;round>0;round--){
    invShiftRows(s);invSubBytes(s);addRoundKey(s,rk,round);invMixColumns(s)
  }
  invShiftRows(s);invSubBytes(s);addRoundKey(s,rk,0);
  return s
}
function aesCbcDecrypt(cipher,key,iv){
  if(cipher.length===0||cipher.length%16!==0)throw new Error("invalid AES ciphertext");
  const out=new Uint8Array(cipher.length),prev=new Uint8Array(iv);
  for(let off=0;off<cipher.length;off+=16){
    const block=aesDecryptBlock(cipher.slice(off,off+16),key);
    for(let i=0;i<16;i++)out[off+i]=block[i]^prev[i];
    prev.set(cipher.slice(off,off+16))
  }
  const pad=out[out.length-1];
  if(!pad||pad>16)throw new Error("invalid AES padding");
  for(let i=out.length-pad;i<out.length;i++)if(out[i]!==pad)throw new Error("invalid AES padding");
  return out.slice(0,out.length-pad)
}
function rotr(x,n){return(x>>>n)|(x<<(32-n))}
function sha256(data){
  const K=[
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,
    0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb3,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87874,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  const bitLen=data.length*8,blocks=Math.ceil((data.length+9)/64),padded=new Uint8Array(blocks*64);
  padded.set(data);padded[data.length]=128;
  const hi=Math.floor(bitLen/4294967296),lo=bitLen>>>0;
  const p=padded.length-8;
  padded[p]=(hi>>>24)&255;padded[p+1]=(hi>>>16)&255;padded[p+2]=(hi>>>8)&255;padded[p+3]=hi&255;
  padded[p+4]=(lo>>>24)&255;padded[p+5]=(lo>>>16)&255;padded[p+6]=(lo>>>8)&255;padded[p+7]=lo&255;
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const w=new Uint32Array(64);
  for(let off=0;off<padded.length;off+=64){
    for(let i=0;i<16;i++){const j=off+i*4;w[i]=((padded[j]<<24)|(padded[j+1]<<16)|(padded[j+2]<<8)|padded[j+3])>>>0}
    for(let i=16;i<64;i++){
      const s0=(rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3))>>>0;
      const s1=(rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10))>>>0;
      w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,hh=h7;
    for(let i=0;i<64;i++){
      const S1=(rotr(e,6)^rotr(e,11)^rotr(e,25))>>>0,ch=((e&f)^((~e)&g))>>>0;
      const temp1=(hh+S1+ch+K[i]+w[i])>>>0;
      const S0=(rotr(a,2)^rotr(a,13)^rotr(a,22))>>>0,maj=((a&b)^(a&c)^(b&c))>>>0;
      const temp2=(S0+maj)>>>0;
      hh=g;g=f;f=e;e=(d+temp1)>>>0;d=c;c=b;b=a;a=(temp1+temp2)>>>0
    }
    h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+hh)>>>0
  }
  const out=new Uint8Array(32),hs=[h0,h1,h2,h3,h4,h5,h6,h7];
  for(let i=0;i<8;i++){out[i*4]=hs[i]>>>24;out[i*4+1]=hs[i]>>>16;out[i*4+2]=hs[i]>>>8;out[i*4+3]=hs[i]}
  return out
}
function concat(a,b){const o=new Uint8Array(a.length+b.length);o.set(a);o.set(b,a.length);return o}
function hmacSha256(key,data){
  let k=key;
  if(k.length>64)k=sha256(k);
  const kb=new Uint8Array(64);kb.set(k);
  const ipad=new Uint8Array(64),opad=new Uint8Array(64);
  for(let i=0;i<64;i++){ipad[i]=kb[i]^0x36;opad[i]=kb[i]^0x5c}
  return sha256(concat(opad,sha256(concat(ipad,data))))
}
function b64url(bytes){
  const table="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out="";
  for(let i=0;i<bytes.length;i+=3){
    const a=bytes[i],b=i+1<bytes.length?bytes[i+1]:0,c=i+2<bytes.length?bytes[i+2]:0;
    out+=table[a>>2]+table[((a&3)<<4)|(b>>4)]+(i+1<bytes.length?table[((b&15)<<2)|(c>>6)]:"=")+(i+2<bytes.length?table[c&63]:"=")
  }
  return out.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")
}
const AES_KEY=utf8("i?LMTAx0Q6,:}50U");
const AES_KEY_32=new Uint8Array(32);AES_KEY_32.set(AES_KEY);
const AES_IV=utf8("W0;27ToaUpl_P%'c");
const TOKEN_KEY=utf8("MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s");

function sourceFile(response){
  const encrypted=response&&response.enc;
  if(typeof encrypted==="string"&&encrypted){
    try{
      const plain=bytesToString(aesCbcDecrypt(b64decode(encrypted),AES_KEY_32,AES_IV));
      const d=JSON.parse(plain);
      return d&&typeof d.file==="string"?d.file:null
    }catch(e){log("MEGAPLAY AES FAILED "+String(e&&e.message||e));return null}
  }
  const sources=response&&response.sources;
  if(sources&&typeof sources==="object"&&!Array.isArray(sources)&&typeof sources.file==="string")return sources.file;
  if(Array.isArray(sources)&&sources.length&&sources[0]&&typeof sources[0].file==="string")return sources[0].file;
  return null
}
function signUrl(fileUrl){
  const m=String(fileUrl||"").match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
  if(!m)return fileUrl;
  const expires=Math.floor(Date.now()/1000)+90;
  const payload=utf8(String(expires)+"|"+m[1].toLowerCase()+"/"+m[2].toLowerCase());
  const sig=hmacSha256(TOKEN_KEY,payload);
  const token=b64url(payload)+"."+b64url(sig);
  const encoded=encodeURIComponent(token);
  const raw=String(fileUrl);
  if(/[?&]token=[^&]*/i.test(raw))return raw.replace(/([?&]token=)[^&]*/i,"$1"+encoded);
  return raw+(raw.includes("?")?"&":"?")+"token="+encoded
}

/* ---------- Extractors ---------- */
function extractHost(url){
  try{
    const m=String(url||"").match(/^(?:https?:)?\/\/([^/]+)/i);
    if(!m)return"";
    const host=m[1].toLowerCase().split(":")[0];
    const parts=host.split(".");
    return parts.length>=2?parts[parts.length-2]:""
  }catch(e){return""}
}
function cleanSlash(s){return String(s||"").replace(/\\/g,"")}

async function megaPlay(url,server){
  const page=await text(url,{headers:{"Referer":BASE+"/","X-Requested-With":"XMLHttpRequest","User-Agent":UA}},EXTRACT_TIMEOUT);
  if(!page)return[];
  const root=parseHTML(page),player=first(root,"#megaplay-player"),mediaId=String(attr(player,"data-id")||"").trim();
  if(!mediaId){log("MEGAPLAY player/data-id missing");return[]}
  const endpoints=["getSources","getSourcesNew"];
  let source=null,response=null;
  for(const ep of endpoints){
    try{
      const originMatch=String(url).match(/^(https?:\/\/[^/]+)/i);
      const origin=originMatch?originMatch[1]:"https://megaplay.buzz";
      const sMatch=String(url).match(/[?&]s=([^&#]+)/);
      const sourceUrl=origin+"/stream/"+ep+"?id="+encodeURIComponent(mediaId)+(sMatch?"&s="+sMatch[1]:"");
      const d=await json(sourceUrl,{headers:{
        "X-Requested-With":"XMLHttpRequest",
        "Referer":url,
        "Origin":origin,
        "User-Agent":UA,
        "Accept":"application/json"
      }},4500);
      if(!d)continue;
      const file=sourceFile(d);
      if(file){source=cleanSlash(file);response=d;break}
    }catch(e){log("MEGAPLAY "+ep+" FAILED")}
  }
  if(!source)return[];
  const tracks=response&&Array.isArray(response.tracks)?response.tracks:[];
  let sub=tracks.find(t=>t&&String(t.kind).toLowerCase()==="captions"&&String(t.label||"").toLowerCase()==="english");
  if(!sub)sub=tracks.find(t=>t&&String(t.kind).toLowerCase()==="captions"&&t.default===true);
  const subtitle=sub&&sub.file?cleanSlash(sub.file):null;
  let subtitleFormat="vtt";
  if(subtitle){
    const mm=subtitle.match(/\.([a-z0-9]+)(?:\?|$)/i);
    if(mm&&["srt","vtt","ass"].includes(mm[1].toLowerCase()))subtitleFormat=mm[1].toLowerCase()
  }
  const finalUrl=signUrl(source);
  return[{
    name:"Anikoto "+(server||"MegaPlay"),
    title:"Anikoto ["+(server||"MegaPlay")+"]",
    url:finalUrl,
    quality:"multi-quality",
    headers:{"Referer":"https://megaplay.buzz/","Origin":"https://megaplay.buzz","User-Agent":UA},
    subtitle,
    subtitleFormat,
    backup:false
  }]
}

async function vidtube(url,server){
  const page=await text(url,{headers:{"Referer":BASE+"/","User-Agent":UA}},EXTRACT_TIMEOUT);
  if(!page)return[];
  const root=parseHTML(page),player=first(root,"#megaplay-player"),id=String(attr(player,"data-id")||"").trim();
  if(!id){log("VIDTUBE player/data-id missing");return[]}
  const pathMatch=String(url).match(/^https?:\/\/[^/]+(\/[^?#]*)/i);
  const pathSegments=(pathMatch&&pathMatch[1]?pathMatch[1].split("/").filter(Boolean):[]);
  const type=pathSegments[pathSegments.length-1]||"";
  if(!type)return[];
  const d=await json("https://vidtube.site/stream/getSourcesNew?id="+encodeURIComponent(id)+"&type="+encodeURIComponent(type),{
    headers:{
      "X-Requested-With":"XMLHttpRequest",
      "Referer":url,
      "Origin":"https://vidtube.site",
      "User-Agent":UA,
      "Accept":"application/json"
    }
  },5000);
  const playlist=String(d&&d.sources&&d.sources.file||"").trim();
  if(!playlist)return[];
  const tracks=Array.isArray(d&&d.tracks)?d.tracks:[];
  const captions=tracks.filter(t=>t&&String(t.kind).toLowerCase()==="captions");
  let sub=captions.find(t=>String(t.lang||"").toLowerCase()==="english");
  if(!sub)sub=captions.find(t=>t&&t.default===true);
  const subtitle=sub&&sub.file?cleanSlash(sub.file):null;
  return[{
    name:"Anikoto "+(server||"VidTube"),
    title:"Anikoto ["+(server||"VidTube")+"]",
    url:cleanSlash(playlist),
    quality:"multi-quality",
    headers:{"Referer":"https://vidtube.site/","Origin":"https://vidtube.site","User-Agent":UA},
    subtitle,
    subtitleFormat:subtitle?"vtt":null,
    backup:false
  }]
}

async function extract(stream,server){
  const host=extractHost(stream.url);
  if(host==="vidtube"){
    log("VIDTUBE "+server);
    return await vidtube(stream.url,server)
  }
  if(host==="megaplay"){
    log("MEGAPLAY "+server);
    return await megaPlay(stream.url,server)
  }
  log("UNSUPPORTED HOST "+host);
  return[]
}

/* ---------- Provider ---------- */
function truthy(v){
  if(v===true)return true;
  const s=String(v==null?"":v).toLowerCase().trim();
  return s==="1"||s==="true"||s==="yes"||s==="on"||s==="dub"||s==="dubs"
}
function mode(settings){
  settings=settings||{};
  const dub=truthy(settings.dub||settings.Dub||settings.language==="dub"||settings.mode==="dub");
  const sub=truthy(settings.sub||settings.Sub||settings.language==="sub"||settings.mode==="sub");
  if(dub&&!sub)return["dub"];
  if(sub&&!dub)return["sub"];
  return["sub","dub"]
}
async function resolveModeServers(episodeId,modeName){
  const wantDub=modeName==="dub";
  const list=await serverList(episodeId,wantDub);
  log("SERVER LIST "+modeName.toUpperCase()+"="+list.length);
  return list
}
async function getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){
  const id=String(tmdbId||"").trim(),type=String(mediaType||"tv").toLowerCase(),s=Number(season)||1,e=Number(episode)||1;
  log("REQUEST TMDB="+id+" S"+s+"E"+e);
  if(!id||type!=="tv")return[];
  const cacheKey="anikoto:streams:"+id+":"+s+":"+e+":"+mode(settings).join(",");
  const cached=CACHE.get(cacheKey);
  if(cached!==undefined){
    log("DONE streams="+cached.length+" cache=1");
    return cached
  }
  try{
    const mapping=await mapperLookup(id,s,e);
    if(!mapping){
      log("DONE streams=0 mapper=read-only-miss");
      return[]
    }
    const anime=await findAnime(mapping);
    if(!anime){
      log("DONE streams=0 anikoto-search-miss");
      return[]
    }
    const ep=await resolveEpisode(anime,mapping);
    if(!ep){
      log("DONE streams=0 episode-miss");
      return[]
    }

    const modes=mode(settings);
    const lists=await Promise.all(modes.map(x=>resolveModeServers(ep.linkId,x).catch(()=>[])));
    const servers=[];
    for(let i=0;i<lists.length;i++)for(const x of lists[i])servers.push({...x,mode:modes[i]});
    if(!servers.length){
      log("DONE streams=0 server-miss");
      return[]
    }

    /* Resolve all server links concurrently. A dead server is isolated. */
    const resolved=await settle(servers.map(server=>async()=>{
      const r=await resolveServer(server);
      if(!r){log("SERVER FAILED "+server.serverName);return null}
      log("SERVER "+server.serverName+" -> "+extractHost(r.url));
      return r
    }));
    if(!resolved.length){
      log("DONE streams=0 server-resolve");
      return[]
    }

    /* Start every independent extractor concurrently. */
    const extracted=await settle(resolved.map(server=>async()=>{
      try{
        const streams=await timeout(extract(server,server.serverName),EXTRACT_TIMEOUT);
        return streams.map(x=>({...x,mode:server.mode}))
      }catch(e){
        log("STREAM FAILED "+server.serverName+" "+String(e&&e.message||e));
        return[]
      }
    }));
    const out=[],seen=new Set();
    for(const batch of extracted)for(const stream of batch||[]){
      const url=String(stream&&stream.url||"").trim();
      if(!url||seen.has(url))continue;
      seen.add(url);
      out.push(stream);
      log("STREAM SUCCESS "+serverLabel(stream)+" "+url.slice(0,120))
    }
    log("DONE streams="+out.length);
    CACHE.set(cacheKey,out,120000);
    return out
  }catch(e){
    log("FATAL "+String(e&&e.message||e));
    return[]
  }
}
function serverLabel(s){return s&&s.name||"Anikoto"}

module.exports={getStreams};
