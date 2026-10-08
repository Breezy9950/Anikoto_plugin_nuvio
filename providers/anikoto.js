/*
 * Anikoto Nuvio provider.
 * Source-derived Anikoto -> MegaPlay/VidTube extraction.
 * Mapping is strictly read-only: this provider only queries the existing mapper
 * with pending=1 and never invokes or writes any population/database function.
 */
const BASE="https://anikototv.to";
const AJAX=BASE+"/ajax";
const MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping";
const UA="Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AD1A.240418.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36";
const AJAX_HEADERS={
  "Referer":BASE+"/",
  "X-Requested-With":"XMLHttpRequest",
  "User-Agent":UA,
  "Accept":"*/*"
};

function log(x){console.log("[Anikoto] "+x)}

class TTLCache{
  constructor(){this.m=new Map()}
  get(k){const x=this.m.get(k);if(!x)return undefined;if(x.e<=Date.now()){this.m.delete(k);return undefined}return x.v}
  set(k,v,ttl){this.m.set(k,{v,e:Date.now()+ttl});return v}
  delete(k){this.m.delete(k)}
}
const CACHE=globalThis.__NUVIO_PROVIDER_CACHE__||(globalThis.__NUVIO_PROVIDER_CACHE__=new TTLCache());

async function req(url,opt,ms){
  opt=opt||{};
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms||5000);
  try{return await fetch(url,Object.assign({},opt,{signal:c.signal}))}
  finally{clearTimeout(t)}
}
async function getText(url,opt,ms){
  try{
    const r=await req(url,opt,ms);
    if(!r||!r.ok){log("HTTP "+(r&&r.status)+" "+String(url).split("?")[0]);return null}
    return await r.text()
  }catch(e){
    log("TEXT FAIL "+String(url).split("?")[0]+" "+String(e&&e.message||e));
    return null
  }
}
async function getJson(url,opt,ms){
  try{
    const r=await req(url,opt,ms);
    if(!r||!r.ok){log("HTTP "+(r&&r.status)+" "+String(url).split("?")[0]);return null}
    return await r.json()
  }catch(e){
    log("JSON FAIL "+String(url).split("?")[0]+" "+String(e&&e.message||e));
    return null
  }
}
async function memo(key,ttl,fn){
  const hit=CACHE.get(key);
  if(hit!==undefined)return await Promise.resolve(hit);
  const p=Promise.resolve().then(fn);
  CACHE.set(key,p,ttl);
  try{
    const v=await p;
    if(v===null||v===undefined)CACHE.delete(key);
    else CACHE.set(key,v,ttl);
    return v
  }catch(e){
    CACHE.delete(key);
    throw e
  }
}
async function settle(tasks,limit=4){
  const out=[],queue=tasks.slice();
  async function worker(){
    while(queue.length){
      const task=queue.shift();
      try{out.push(await task())}catch(e){}
    }
  }
  const n=Math.min(Math.max(1,limit),queue.length);
  await Promise.all(Array.from({length:n},worker));
  return out
}

/* ---------- Small Hermes-safe HTML parser for the exact Anikoto structures ---------- */
function decodeEntities(s){
  return String(s||"")
    .replace(/&#x([0-9a-f]+);?/gi,(_,h)=>String.fromCharCode(parseInt(h,16)))
    .replace(/&#(\d+);?/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&apos;/gi,"'")
    .replace(/&#39;/gi,"'")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">");
}
function parseAttrs(raw){
  const a={};
  const re=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while((m=re.exec(raw||""))){
    const k=String(m[1]||"").toLowerCase();
    if(!k||k==="div"||k==="a"||k==="img"||k==="span"||k==="ul"||k==="li"||k==="script")continue;
    a[k]=decodeEntities(m[2]!==undefined?m[2]:m[3]!==undefined?m[3]:m[4]!==undefined?m[4]:"")
  }
  return a
}
function parseHTML(html){
  const root={tag:"#root",attrs:{},children:[],text:""};
  const stack=[root],src=String(html||"").replace(/<!--[\s\S]*?-->/g,"");
  const token=/<\/?[^>]+>|[^<]+/g;
  let m;
  while((m=token.exec(src))){
    const t=m[0],parent=stack[stack.length-1];
    if(t[0]!=="<"){parent.children.push({tag:"#text",attrs:{},children:[],text:decodeEntities(t)});continue}
    if(/^<\s*\//.test(t)){
      const name=(t.match(/^<\s*\/\s*([^\s>]+)/)||[])[1];
      if(!name)continue;
      for(let i=stack.length-1;i>0;i--){
        if(stack[i].tag===String(name).toLowerCase()){stack.length=i;break}
      }
      continue
    }
    if(/^<\s*!/.test(t)||/^<\s*\?/.test(t))continue;
    const mm=t.match(/^<\s*([^\s/>]+)/);
    if(!mm)continue;
    const tag=String(mm[1]).toLowerCase();
    const selfClosing=/\/\s*>$/.test(t)||/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tag);
    const node={tag,attrs:parseAttrs(t.slice(mm[0].length,-(selfClosing?2:1))),children:[],text:""};
    parent.children.push(node);
    if(!selfClosing)stack.push(node)
  }
  return root
}
function all(root,selector){
  const out=[],sel=String(selector||"").trim();
  const am=sel.match(/^\[([^=\]]+)\]$/);
  if(am){
    const key=am[1].toLowerCase();
    (function visitAttr(n){
      if(!n)return;
      if(n.tag!=="#text"&&Object.prototype.hasOwnProperty.call(n.attrs,key))out.push(n);
      for(const c of n.children||[])visitAttr(c)
    })(root);
    return out
  }
  const m=sel.match(/^([a-z0-9_-]+)?(?:#([a-z0-9_-]+))?(?:\.([a-z0-9_.-]+))?$/i);
  if(!m)return out;
  const tag=m[1]&&m[1].toLowerCase(),id=m[2],classes=(m[3]||"").split(".").filter(Boolean);
  function visit(n){
    if(!n)return;
    if(n.tag!=="#text"){
      const okTag=!tag||n.tag===tag,okId=!id||String(n.attrs.id||"")===id;
      const cs=String(n.attrs.class||"").split(/\s+/);
      const okClass=classes.every(c=>cs.indexOf(c)>=0);
      if(okTag&&okId&&okClass)out.push(n)
    }
    for(const c of n.children||[])visit(c)
  }
  visit(root);
  return out
}
function first(root,selector){return all(root,selector)[0]||null}
function attr(n,k){return n&&n.attrs?String(n.attrs[String(k).toLowerCase()]||""): ""}
function nodeText(n){
  if(!n)return"";
  if(n.tag==="#text")return n.text||"";
  return(n.children||[]).map(nodeText).join(" ")
}
function hasClass(n,c){return String(attr(n,"class")).split(/\s+/).indexOf(c)>=0}
function directChildren(n){return(n&&n.children||[]).filter(x=>x&&x.tag!=="#text")}

/* ---------- Read-only target mapper ---------- */
async function mapperLookup(tmdbId,season,episode){
  const u=MAPPING_URL
    +"?tmdb_id="+encodeURIComponent(tmdbId)
    +"&tmdbId="+encodeURIComponent(tmdbId)
    +"&season="+encodeURIComponent(season)
    +"&episode="+encodeURIComponent(episode)
    +"&pending=1";
  const d=await getJson(u,{headers:{"Accept":"application/json","User-Agent":UA}},5000);
  if(!d||!d.ok||!d.mapping)return null;
  const m=d.mapping;
  const malId=String(m.mal_id||m.malId||"").trim();
  const malEpisode=Number(m.mal_episode!=null?m.mal_episode:m.target_episode);
  if(!malId||!Number.isInteger(malEpisode)||malEpisode<1)return null;
  const titles=[];
  if(Array.isArray(m.titles))titles.push(...m.titles);
  for(const k of ["anime_title","title","name","mal_title","mal_title_english","mal_title_romanji"]){
    if(m[k])titles.push(m[k])
  }
  return{
    malId,
    malEpisode,
    title:String(m.anime_title||m.title||m.name||m.mal_title||"").trim(),
    titles:[...new Set(titles.map(x=>String(x||"").trim()).filter(Boolean))],
    seasonName:String(m.season_name||m.seasonName||"").trim()
  }
}

/* ---------- Anikoto search / matching ---------- */
function normalizeTitle(s){
  let x=String(s||"").toLowerCase().replace(/&/g,"and");
  try{x=x.normalize("NFKD").replace(/[\u0300-\u036f]/g,"")}catch(e){}
  return x.replace(/[^a-z0-9]+/g,"").trim()
}
function searchTitleBase(s){
  return String(s||"").split(":")[0].replace(/\b(?:season|saison)\s*\d+\b/ig,"").replace(/\b\d+(?:st|nd|rd|th)\s+season\b/ig,"").trim()
}
function titleSeason(s){
  const x=String(s||"");
  let m=x.match(/\bseason\s*([0-9]+)\b/i);
  if(m)return Number(m[1]);
  m=x.match(/\bs([0-9]{1,2})(?:\b|[-\s])/i);
  return m?Number(m[1]):null
}
function cardScore(card,targets,base,season){
  const ct=normalizeTitle(card.name),cb=normalizeTitle(base);
  let best=0;
  for(const t of targets){
    const nt=normalizeTitle(t);
    if(!nt)continue;
    if(ct===nt)best=Math.max(best,1000);
    else if(ct.includes(nt)||nt.includes(ct))best=Math.max(best,800);
    else{
      const nb=normalizeTitle(searchTitleBase(t));
      if(nb&&(ct===nb||ct.includes(nb)||nb.includes(ct)))best=Math.max(best,650)
    }
  }
  if(cb&&ct===cb)best=Math.max(best,900);
  const explicit=titleSeason(card.name);
  if(explicit!==null){
    if(explicit===season)best+=150;
    else best-=1000
  }else if(season===1&&/\b(?:season|saison)\s*\d+\b/i.test(card.name))best-=700;
  return best
}
function parseSearchCards(html){
  const root=parseHTML(html),container=first(root,"div.scaff.items");
  if(!container)return[];
  const direct=directChildren(container);
  const pool=direct.length?direct:all(container,"a");
  const out=[],seen=new Set();
  for(const item of pool){
    const href=attr(item,"href");
    if(!href||seen.has(href))continue;
    const titleNode=first(item,".name.d-title");
    const name=decodeEntities(nodeText(titleNode||item)).replace(/\s+/g," ").trim();
    if(!name)continue;
    const img=first(item,"img");
    seen.add(href);
    out.push({name,href,img:attr(img,"src")||""})
  }
  return out
}
async function search(query){
  const q=String(query||"").trim();
  if(!q)return[];
  const key="anikoto:search:"+normalizeTitle(q);
  const hit=CACHE.get(key);
  if(hit!==undefined)return await Promise.resolve(hit);
  const started=Date.now();
  const d=await getJson(
    AJAX+"/anime/search?keyword="+encodeURIComponent(q),
    {headers:AJAX_HEADERS},
    5000
  );
  const html=d&&d.result&&d.result.html;
  if(!html)return[];
  const cards=parseSearchCards(html);
  log("SEARCH "+q+" results="+cards.length+" "+(Date.now()-started)+"ms");
  if(cards.length)CACHE.set(key,cards,600000);
  return cards
}
function absoluteUrl(href){
  try{return new URL(href,BASE+"/").toString()}catch(e){return BASE+(String(href||"").startsWith("/")?href:"/"+href)}
}
async function findAnime(mapping,season){
  const rawQueries=[mapping.title,...mapping.titles].filter(Boolean);
  const queries=[];
  for(const q of rawQueries){queries.push(String(q));const b=searchTitleBase(q);if(b&&b!==q)queries.push(b)}
  const unique=[...new Set(queries.map(x=>x.trim()).filter(Boolean))];
  if(!unique.length)return null;
  const allCards=[];
  const seen=new Set();
  const results=await settle(unique.slice(0,6).map(q=>()=>search(q)),3);
  for(const rs of results)for(const c of rs||[]){
    const key=String(c.href);
    if(!seen.has(key)){seen.add(key);allCards.push(c)}
  }
  if(!allCards.length)return null;
  const scored=allCards.map(c=>({c,score:cardScore(c,unique,mapping.title,season)}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  const best=scored[0];
  if(!best)return null;
  log("ANIME MATCH "+best.c.name+" score="+best.score);
  return best.c
}

/* ---------- Anikoto anime / episode / server discovery ---------- */
async function getAnimeId(animeUrl){
  const key="anikoto:animeid:"+animeUrl;
  return memo(key,600000,async()=>{
    const started=Date.now();
    const html=await getText(animeUrl,{headers:AJAX_HEADERS},6000);
    if(!html)return null;
    const root=parseHTML(html),watch=first(root,"div#watch-main"),id=attr(watch,"data-id").trim();
    if(!id){log("ANIME ID NOT FOUND");return null}
    log("ANIME ID "+id+" "+(Date.now()-started)+"ms");
    return id
  })
}
async function getEpisodes(animeId){
  const key="anikoto:episodes:"+animeId;
  return memo(key,600000,async()=>{
    const started=Date.now();
    const d=await getJson(AJAX+"/episode/list/"+encodeURIComponent(animeId)+"?vrf=",{headers:AJAX_HEADERS},6000);
    const html=d&&d.result;
    if(!html)return[];
    const root=parseHTML(html),box=first(root,"div.episodes");
    if(!box)return[];
    const out=[],seen=new Set();
    for(const a of all(box,"a")){
      const id=attr(a,"data-ids").trim(),num=Number(attr(a,"data-num"));
      if(!id||!Number.isInteger(num)||num<1||seen.has(id))continue;
      seen.add(id);
      out.push({
        episodeId:id,
        episodeNumber:num,
        malId:attr(a,"data-mal").trim(),
        hasDub:attr(a,"data-dub")==="1",
        title:attr(a,"title").trim(),
        href:attr(a,"href").trim()
      })
    }
    out.sort((a,b)=>a.episodeNumber-b.episodeNumber);
    log("EPISODES="+out.length+" "+(Date.now()-started)+"ms");
    return out
  })
}
async function getServerList(episodeId){
  const key="anikoto:servers:"+episodeId;
  return memo(key,120000,async()=>{
    const started=Date.now();
    const d=await getJson(AJAX+"/server/list?servers="+encodeURIComponent(episodeId),{headers:AJAX_HEADERS},5000);
    const html=d&&d.result;
    if(!html)return[];
    const root=parseHTML(html),groups=all(root,"div.servers"),out=[];
    for(const group of groups){
      const groupName=nodeText(directChildren(group)[0]||group).replace(/\s+/g," ").trim();
      for(const type of all(group,"div.type")){
        const dataType=attr(type,"data-type").toLowerCase();
        if(dataType!=="sub"&&dataType!=="dub")continue;
        for(const item of all(type,"[data-link-id]")){
          const linkId=attr(item,"data-link-id").trim();
          if(!linkId)continue;
          const serverName=nodeText(item).replace(/\s+/g," ").trim();
          out.push({srv_name:serverName||"Anikoto",link_id:linkId,group_name:groupName,dataType})
        }
      }
    }
    log("SERVERS="+out.length+" "+(Date.now()-started)+"ms");
    return out
  })
}

/* ---------- Source-compatible crypto: AES-256-CBC + HMAC-SHA256 ---------- */
function utf8Bytes(s){
  const str=String(s||""),out=[];
  for(let i=0;i<str.length;i++){
    let c=str.charCodeAt(i);
    if(c>=0xD800&&c<=0xDBFF&&i+1<str.length){
      const d=str.charCodeAt(++i);
      if(d>=0xDC00&&d<=0xDFFF)c=0x10000+((c-0xD800)<<10)+(d-0xDC00)
      else{i--;c=0xFFFD}
    }
    if(c<0x80)out.push(c);
    else if(c<0x800)out.push(0xC0|(c>>6),0x80|(c&63));
    else if(c<0x10000)out.push(0xE0|(c>>12),0x80|((c>>6)&63),0x80|(c&63));
    else out.push(0xF0|(c>>18),0x80|((c>>12)&63),0x80|((c>>6)&63),0x80|(c&63));
  }
  return new Uint8Array(out)
}
function bytesToUtf8(bytes){
  let out="";
  for(let i=0;i<bytes.length;){
    const c=bytes[i++];
    if(c<0x80){out+=String.fromCharCode(c);continue}
    if(c<0xE0){out+=String.fromCharCode(((c&31)<<6)|(bytes[i++]&63));continue}
    if(c<0xF0){out+=String.fromCharCode(((c&15)<<12)|((bytes[i++]&63)<<6)|(bytes[i++]&63));continue}
    const cp=((c&7)<<18)|((bytes[i++]&63)<<12)|((bytes[i++]&63)<<6)|(bytes[i++]&63);
    const x=cp-0x10000;out+=String.fromCharCode(0xD800+(x>>10),0xDC00+(x&1023))
  }
  return out
}
const B64="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64Decode(s){
  let x=String(s||"").replace(/-/g,"+").replace(/_/g,"/").replace(/[^A-Za-z0-9+/=]/g,"");
  while(x.length%4)x+="=";
  const out=[];
  for(let i=0;i<x.length;i+=4){
    const a=B64.indexOf(x[i]),b=B64.indexOf(x[i+1]),c=x[i+2]==="="?0:B64.indexOf(x[i+2]),d=x[i+3]==="="?0:B64.indexOf(x[i+3]);
    const n=(a<<18)|(b<<12)|(c<<6)|d;
    out.push((n>>16)&255);
    if(x[i+2]!=="=")out.push((n>>8)&255);
    if(x[i+3]!=="=")out.push(n&255)
  }
  return new Uint8Array(out)
}
function base64Url(bytes){
  let out="";
  for(let i=0;i<bytes.length;i+=3){
    const a=bytes[i],b=i+1<bytes.length?bytes[i+1]:0,c=i+2<bytes.length?bytes[i+2]:0,n=(a<<16)|(b<<8)|c;
    out+=B64[(n>>18)&63]+B64[(n>>12)&63]+(i+1<bytes.length?B64[(n>>6)&63]:"")+(i+2<bytes.length?B64[n&63]:"")
  }
  return out.replace(/\+/g,"-").replace(/\//g,"_")
}
function rotl8(x,n){return((x<<n)|(x>>(8-n)))&255}
function gmul(a,b){
  let p=0;
  for(let i=0;i<8;i++){if(b&1)p^=a;const hi=a&128;a=(a<<1)&255;if(hi)a^=0x1b;b>>=1}
  return p
}
function gpow(a,n){let r=1;while(n){if(n&1)r=gmul(r,a);a=gmul(a,a);n>>=1}return r}
function makeSbox(){
  const s=new Uint8Array(256),inv=new Uint8Array(256);
  for(let x=0;x<256;x++){
    const y=x===0?0:gpow(x,254);
    const v=(y^rotl8(y,1)^rotl8(y,2)^rotl8(y,3)^rotl8(y,4)^0x63)&255;
    s[x]=v;inv[v]=x
  }
  return{s,inv}
}
const AESBOX=makeSbox();
function aesExpandKey(key){
  const nk=8,nr=14,w=new Uint8Array(4*4*(nr+1));
  for(let i=0;i<32;i++)w[i]=key[i]||0;
  let bytes=32,rcon=1;
  while(bytes<w.length){
    let t=[w[bytes-4],w[bytes-3],w[bytes-2],w[bytes-1]];
    if(bytes%32===0){
      t=[AESBOX.s[t[1]],AESBOX.s[t[2]],AESBOX.s[t[3]],AESBOX.s[t[0]]];
      t[0]^=rcon;rcon=gmul(rcon,2)
    }else if(bytes%32===16){
      t=t.map(x=>AESBOX.s[x])
    }
    for(let i=0;i<4;i++){w[bytes]=w[bytes-32]^t[i];bytes++}
  }
  return w
}
function addRoundKey(st,key,round){const off=round*16;for(let i=0;i<16;i++)st[i]^=key[off+i]}
function invSubBytes(st){for(let i=0;i<16;i++)st[i]=AESBOX.inv[st[i]]}
function invShiftRows(st){
  const x=st.slice();
  for(let r=0;r<4;r++)for(let c=0;c<4;c++)st[4*c+r]=x[4*((c-r+4)%4)+r]
}
function invMixColumns(st){
  for(let c=0;c<4;c++){
    const i=4*c,a=st[i],b=st[i+1],d=st[i+2],e=st[i+3];
    st[i]=gmul(a,14)^gmul(b,11)^gmul(d,13)^gmul(e,9);
    st[i+1]=gmul(a,9)^gmul(b,14)^gmul(d,11)^gmul(e,13);
    st[i+2]=gmul(a,13)^gmul(b,9)^gmul(d,14)^gmul(e,11);
    st[i+3]=gmul(a,11)^gmul(b,13)^gmul(d,9)^gmul(e,14)
  }
}
function aesDecryptBlock(input,key){
  const st=new Uint8Array(input),rounds=14;
  addRoundKey(st,key,rounds);
  for(let r=rounds-1;r>0;r--){invShiftRows(st);invSubBytes(st);addRoundKey(st,key,r);invMixColumns(st)}
  invShiftRows(st);invSubBytes(st);addRoundKey(st,key,0);
  return st
}
function aesCbcDecrypt(cipher,key,iv){
  if(cipher.length%16!==0)throw new Error("AES ciphertext length");
  const out=new Uint8Array(cipher.length),k=aesExpandKey(key);
  let prev=iv.slice();
  for(let off=0;off<cipher.length;off+=16){
    const block=aesDecryptBlock(cipher.slice(off,off+16),k);
    for(let i=0;i<16;i++)out[off+i]=block[i]^prev[i];
    prev=cipher.slice(off,off+16)
  }
  const pad=out[out.length-1];
  if(pad<1||pad>16)throw new Error("AES padding");
  for(let i=out.length-pad;i<out.length;i++)if(out[i]!==pad)throw new Error("AES padding");
  return out.slice(0,out.length-pad)
}
function sha256(bytes){
  const K=[
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  const bitLen=bytes.length*8,blocks=Math.ceil((bytes.length+9)/64),data=new Uint8Array(blocks*64);
  data.set(bytes);data[bytes.length]=128;
  const hi=Math.floor(bitLen/0x100000000),lo=bitLen>>>0;
  data[data.length-8]=(hi>>>24)&255;data[data.length-7]=(hi>>>16)&255;data[data.length-6]=(hi>>>8)&255;data[data.length-5]=hi&255;
  data[data.length-4]=(lo>>>24)&255;data[data.length-3]=(lo>>>16)&255;data[data.length-2]=(lo>>>8)&255;data[data.length-1]=lo&255;
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const rotr=(x,n)=>(x>>>n)|(x<<(32-n)),add=(...xs)=>xs.reduce((a,b)=>(a+b)>>>0,0);
  for(let off=0;off<data.length;off+=64){
    const w=new Uint32Array(64);
    for(let i=0;i<16;i++){const p=off+i*4;w[i]=((data[p]<<24)|(data[p+1]<<16)|(data[p+2]<<8)|data[p+3])>>>0}
    for(let i=16;i<64;i++){
      const s0=rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3);
      const s1=rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10);
      w[i]=add(w[i-16],s0,w[i-7],s1)
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for(let i=0;i<64;i++){
      const S1=rotr(e,6)^rotr(e,11)^rotr(e,25),ch=(e&f)^((~e)&g);
      const temp1=add(h,S1,ch,K[i],w[i]);
      const S0=rotr(a,2)^rotr(a,13)^rotr(a,22),maj=(a&b)^(a&c)^(b&c);
      const temp2=add(S0,maj);
      h=g;g=f;f=e;e=add(d,temp1);d=c;c=b;b=a;a=add(temp1,temp2)
    }
    h0=add(h0,a);h1=add(h1,b);h2=add(h2,c);h3=add(h3,d);h4=add(h4,e);h5=add(h5,f);h6=add(h6,g);h7=add(h7,h)
  }
  const out=new Uint8Array(32),v=[h0,h1,h2,h3,h4,h5,h6,h7];
  for(let i=0;i<8;i++){out[i*4]=(v[i]>>>24)&255;out[i*4+1]=(v[i]>>>16)&255;out[i*4+2]=(v[i]>>>8)&255;out[i*4+3]=v[i]&255}
  return out
}
function hmacSha256(key,msg){
  let k=key.length>64?sha256(key):key.slice();
  if(k.length<64){const x=new Uint8Array(64);x.set(k);k=x}
  const o=new Uint8Array(64),i=new Uint8Array(64);
  for(let n=0;n<64;n++){o[n]=k[n]^0x5c;i[n]=k[n]^0x36}
  const inner=new Uint8Array(i.length+msg.length);inner.set(i);inner.set(msg,i.length);
  const ih=sha256(inner),outer=new Uint8Array(o.length+ih.length);outer.set(o);outer.set(ih,o.length);
  return sha256(outer)
}
function sourceFile(response){
  const encrypted=response&&response.enc;
  if(typeof encrypted==="string"&&encrypted){
    const key=new Uint8Array(32);key.set(utf8Bytes("i?LMTAx0Q6,:}50U").slice(0,32));
    const iv=utf8Bytes("W0;27ToaUpl_P%'c").slice(0,16);
    const plain=bytesToUtf8(aesCbcDecrypt(base64Decode(encrypted),key,iv));
    const obj=JSON.parse(plain);
    return obj&&typeof obj.file==="string"?obj.file:null
  }
  const s=response&&response.sources;
  if(s&&typeof s==="object"&&!Array.isArray(s)&&typeof s.file==="string")return s.file;
  if(Array.isArray(s)&&s.length&&s[0]&&typeof s[0].file==="string")return s[0].file;
  return null
}
function signUrl(fileUrl){
  let u;
  try{u=new URL(String(fileUrl))}catch(e){return String(fileUrl||"")}
  const m=u.pathname.match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
  if(!m)return String(fileUrl||"");
  const expires=Math.floor(Date.now()/1000)+90;
  const payload=utf8Bytes(expires+"|"+m[1].toLowerCase()+"/"+m[2].toLowerCase());
  const sig=hmacSha256(utf8Bytes("MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s"),payload);
  u.searchParams.set("token",base64Url(payload)+"."+base64Url(sig));
  return u.toString()
}
function subtitleFromTracks(tracks,kind){
  if(!Array.isArray(tracks))return null;
  const captions=tracks.filter(t=>t&&String(t.kind||"").toLowerCase()==="captions");
  if(!captions.length)return null;
  let s;
  if(kind==="megaplay")s=captions.find(t=>String(t.label||"").toLowerCase()==="english")||captions.find(t=>t.default===true)||captions[0];
  else s=captions.find(t=>String(t.lang||"").toLowerCase()==="english")||captions.find(t=>t.default===true)||captions[0];
  const url=String(s&&s.file||"").replace(/\\/g,"").trim();
  if(!url)return null;
  const m=url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i),ext=m&&m[1].toLowerCase();
  return{url,format:ext==="srt"||ext==="vtt"||ext==="ass"?ext:"vtt"}
}

/* ---------- Host extraction ---------- */
function streamType(url){
  const s=String(url||"").split(/[?#]/)[0].toLowerCase();
  if(/\.mpd$/.test(s))return"mpd";
  if(/\.mp4$/.test(s))return"mp4";
  if(/\.mkv$/.test(s))return"mkv";
  if(/\.webm$/.test(s))return"webm";
  return"m3u8"
}
function validMediaUrl(url){
  const s=String(url||"").trim();
  if(!/^https?:\/\//i.test(s))return false;
  if(/(?:<html|<!doctype|application\/json|\/(?:ajax|api)\b)/i.test(s))return false;
  if(/\.(?:m3u8|mp4|mkv|webm|mpd|m4s)(?:$|[?#])/i.test(s))return true;
  if(/[?&](?:token|signature)=/i.test(s)&&/[a-f0-9]{32}/i.test(s))return true;
  return false
}
async function extractMegaPlay(url,quality,server){
  const html=await getText(url,{headers:AJAX_HEADERS},6000);
  if(!html)return null;
  const root=parseHTML(html),player=first(root,"#megaplay-player"),mediaId=attr(player,"data-id").trim();
  if(!mediaId){log("MEGAPLAY PLAYER ID MISSING");return null}
  log("MEGAPLAY PLAYER ID "+mediaId);
  let response=null,file=null;
  for(const endpoint of ["getSources","getSourcesNew"]){
    const page=new URL(url),api=new URL("/stream/"+endpoint,page.origin);
    api.searchParams.set("id",mediaId);
    if(page.searchParams.get("s")!==null)api.searchParams.set("s",page.searchParams.get("s"));
    const d=await getJson(api.toString(),{headers:{"X-Requested-With":"XMLHttpRequest","Referer":url,"User-Agent":UA}},6000);
    if(!d)continue;
    try{file=sourceFile(d)}catch(e){log("MEGAPLAY "+endpoint+" DECODE FAILED");file=null}
    if(file){response=d;log("MEGAPLAY SOURCES "+endpoint);break}
  }
  if(!file||!response)return null;
  file=String(file).replace(/\\/g,"").trim();
  if(!validMediaUrl(file)){log("MEGAPLAY SOURCE NOT MEDIA");return null}
  const sub=subtitleFromTracks(response.tracks,"megaplay");
  const signed=signUrl(file);
  log("MEGAPLAY STREAM SUCCESS");
  return{
    name:"Anikoto [MegaPlay]",
    title:"Anikoto MegaPlay",
    url:signed,
    quality:quality||"multi-quality",
    server:server||"MegaPlay",
    backup:false,
    headers:{
      Referer:"https://megaplay.buzz/",
      Origin:"https://megaplay.buzz"
    },
    customHeaders:{
      Referer:"https://megaplay.buzz/",
      Origin:"https://megaplay.buzz"
    },
    subtitle:sub&&sub.url||null,
    subtitleFormat:sub&&sub.format||"vtt"
  }
}
async function extractVidTube(url,quality,server){
  const html=await getText(url,{headers:AJAX_HEADERS},6000);
  if(!html)return null;
  const root=parseHTML(html),player=first(root,"#megaplay-player"),id=attr(player,"data-id").trim();
  if(!id){log("VIDTUBE PLAYER ID MISSING");return null}
  log("VIDTUBE PLAYER ID "+id);
  let type="";
  try{type=new URL(url).pathname.split("/").filter(Boolean).pop()||""}catch(e){}
  if(!type)return null;
  const api="https://vidtube.site/stream/getSourcesNew?id="+encodeURIComponent(id)+"&type="+encodeURIComponent(type);
  const d=await getJson(api,{headers:{"X-Requested-With":"XMLHttpRequest","Referer":url,"User-Agent":UA}},6000);
  const file=d&&d.sources&&typeof d.sources==="object"&&String(d.sources.file||"").trim();
  if(!file||!validMediaUrl(file)){log("VIDTUBE SOURCE NOT MEDIA");return null}
  const sub=subtitleFromTracks(d.tracks,"vidtube");
  log("VIDTUBE STREAM SUCCESS");
  return{
    name:"Anikoto [VidTube]",
    title:"Anikoto VidTube",
    url:String(file).replace(/\\/g,"").trim(),
    quality:quality||"multi-quality",
    server:server||"VidTube",
    backup:false,
    headers:{
      Referer:"https://vidtube.site/",
      Origin:"https://vidtube.site"
    },
    customHeaders:{
      Referer:"https://vidtube.site/",
      Origin:"https://vidtube.site"
    },
    subtitle:sub&&sub.url||null,
    subtitleFormat:sub&&sub.format||"vtt"
  }
}
async function extractHost(url,quality,server){
  let host="";
  try{host=new URL(url).hostname.toLowerCase().split(".")[0]}catch(e){return null}
  if(host==="megaplay")return extractMegaPlay(url,quality,server).catch(e=>{log("MEGAPLAY FAILED "+String(e&&e.message||e));return null});
  if(host==="vidtube")return extractVidTube(url,quality,server).catch(e=>{log("VIDTUBE FAILED "+String(e&&e.message||e));return null});
  log("Unsupported host="+host);
  return null
}

/* ---------- Nuvio settings / stream resolution ---------- */
function boolSetting(v,def){
  if(v===undefined||v===null)return def;
  if(typeof v==="boolean")return v;
  const s=String(v).toLowerCase();
  if(s==="true"||s==="1"||s==="yes"||s==="on"||s==="enabled")return true;
  if(s==="false"||s==="0"||s==="no"||s==="off"||s==="disabled")return false;
  return def
}
function getSetting(settings,names,def){
  for(const n of names){
    if(settings&&Object.prototype.hasOwnProperty.call(settings,n))return settings[n];
  }
  return def
}
function modes(settings){
  const subKeys=["sub","Sub","subtitle","subtitles"],dubKeys=["dub","Dub"];
  const hasSub=subKeys.some(k=>settings&&Object.prototype.hasOwnProperty.call(settings,k));
  const hasDub=dubKeys.some(k=>settings&&Object.prototype.hasOwnProperty.call(settings,k));
  const sub=boolSetting(getSetting(settings,subKeys,true),true);
  const dub=boolSetting(getSetting(settings,dubKeys,false),false);
  if(!hasSub&&!hasDub)return[false];
  const out=[];
  if(sub)out.push(false);
  if(dub)out.push(true);
  return out
}
function qualitySetting(settings){return String(getSetting(settings,["quality","Quality"],"multi-quality")||"multi-quality")}

async function resolveServers(servers,quality){
  const started=Date.now(),state={firstStart:started,firstStreamLogged:false},tasks=servers.map(server=>async()=>{
    const serverStarted=Date.now(),link=server&&server.link_id;
    if(!link)return null;
    const d=await getJson(AJAX+"/server?get="+encodeURIComponent(link),{headers:AJAX_HEADERS},5000);
    const streamUrl=String(d&&d.result&&d.result.url||"").trim();
    if(!streamUrl)return null;
    log("SERVER RESOLVE "+String(server.srv_name||"Anikoto")+" "+(Date.now()-serverStarted)+"ms");
    let host="";
    try{host=new URL(streamUrl).hostname.toLowerCase().split(".")[0]}catch(e){}
    log("HOST="+(host||"unknown"));
    const extractStarted=Date.now();
    const stream=await extractHost(streamUrl,quality,String(server.srv_name||"Anikoto"));
    log("EXTRACT "+(host||"unknown")+" "+(Date.now()-extractStarted)+"ms");
    if(!stream)return null;
    stream.title="Anikoto "+(server.dataType==="dub"?"DUB":"SUB")+" - "+(server.srv_name||"Anikoto");
    stream.name="Anikoto ["+(server.dataType==="dub"?"DUB":"SUB")+"] "+(server.srv_name||"Anikoto");
    stream.provider="anikoto";
    stream.type=streamType(stream.url);
    if(!state.firstStreamLogged){
      state.firstStreamLogged=true;
      log("TIME TO FIRST STREAM "+(Date.now()-state.firstStart)+"ms");
    }
    return stream
  });
  const out=await settle(tasks,4);
  log("SERVER/EXTRACTION TOTAL "+(Date.now()-started)+"ms");
  return out
}
async function resolveMode(episodeId,isDub,quality){
  const servers=(await getServerList(episodeId)).filter(x=>x.dataType===(isDub?"dub":"sub"));
  if(!servers.length)return[];
  const streams=await resolveServers(servers,quality);
  const out=[],seen=new Set();
  for(const s of streams){
    if(!s||!validMediaUrl(s.url)||seen.has(s.url))continue;
    seen.add(s.url);out.push(s)
  }
  return out
}

async function getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){
  try{
    const type=String(mediaType||"tv").toLowerCase();
    if(type!=="tv")return[];
    const id=String(tmdbId||"").trim(),s=Number(season)||1,e=Number(episode)||1;
    if(!id)return[];
    const key="anikoto:streams:"+id+":"+s+":"+e+":"+JSON.stringify(settings||{});
    const hit=CACHE.get(key);
    if(hit!==undefined)return await Promise.resolve(hit);
    const p=(async()=>{
      const started=Date.now();
      log("REQUEST TMDB="+id+" S"+s+"E"+e);
      const mapperStarted=Date.now();
      const mapping=await mapperLookup(id,s,e);
      log("MAPPER "+(Date.now()-mapperStarted)+"ms");
      if(!mapping){
        log("MAPPING MISS — READ ONLY, NO POPULATION");
        return[]
      }
      log("MAPPING HIT MAL="+mapping.malId+" E"+mapping.malEpisode);
      const searchStarted=Date.now();
      const anime=findAnime(mapping,s);
      const modesList=modes(settings);
      const [animeResult]=await Promise.all([anime]);
      log("SEARCH/MATCH TOTAL "+(Date.now()-searchStarted)+"ms");
      if(!animeResult){
        log("ANIME MATCH FAILED");
        return[]
      }
      const animeUrl=absoluteUrl(animeResult.href);
      const animeId=await getAnimeId(animeUrl);
      if(!animeId)return[];
      const episodes=await getEpisodes(animeId);
      let episodeMatch=episodes.find(x=>x.episodeNumber===mapping.malEpisode);
      if(!episodeMatch){
        log("EPISODE MATCH FAILED MAL E"+mapping.malEpisode);
        return[]
      }
      if(modesList.indexOf(true)>=0&&!episodeMatch.hasDub){
        log("DUB REQUESTED BUT EPISODE HAS NO DUB");
        if(modesList.length===1)return[]
      }
      log("EPISODE MATCH E"+episodeMatch.episodeNumber+" ID="+episodeMatch.episodeId);
      const modeResults=await Promise.all(
        modesList.map(isDub=>resolveMode(episodeMatch.episodeId,isDub,qualitySetting(settings)))
      );
      const allStreams=modeResults.flat();
      const seen=new Set(),out=[];
      for(const stream of allStreams){
        if(!stream||!stream.url||seen.has(stream.url))continue;
        seen.add(stream.url);out.push(stream)
      }
      log("DONE streams="+out.length+" time="+(Date.now()-started)+"ms");
      return out
    })();
    CACHE.set(key,p,1800000);
    try{
      const v=await p;
      return CACHE.set(key,v,1800000)
    }catch(e){
      CACHE.delete(key);
      log("ERROR "+String(e&&e.message||e));
      return[]
    }
  }catch(e){
    log("FATAL "+String(e&&e.message||e));
    return[]
  }
}

module.exports={getStreams};
