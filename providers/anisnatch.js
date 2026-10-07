/* AniSnatch Nuvio provider.
 * Lazy mapper is read-only/authoritative. This provider never populates or writes mapping data.
 */
const BASE="https://anisnatch.to";
const MAPPING_URL="https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping";
const TMDB_KEY="68e094699525b18a70bab2f86b1fa706";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const PROXY_PARAM="1~2~3~4~5";
const TIMEOUT=12000, SOURCE_TIMEOUT=8000, HLS_TIMEOUT=5000;
function log(x){console.log("[AniSnatch] "+x)}
async function req(url,opt={},timeout=TIMEOUT){
  const o={...opt,credentials:"include",headers:{...((opt&&opt.headers)||{}),"User-Agent":UA}};
  if(typeof AbortController!=="function"||typeof setTimeout!=="function")return fetch(url,o);
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
  try{return await fetch(url,{...o,signal:c.signal})}finally{clearTimeout(t)}
}
async function text(url,opt={},timeout=TIMEOUT){try{const r=await req(url,opt,timeout);return r&&r.ok?await r.text():null}catch(e){return null}}
async function json(url,opt={},timeout=TIMEOUT){try{const r=await req(url,{...opt,headers:{"Accept":"application/json",...((opt&&opt.headers)||{})}},timeout);return r&&r.ok?await r.json():null}catch(e){return null}}
async function bytes(url,opt={},timeout=TIMEOUT){try{const r=await req(url,opt,timeout);return r&&r.ok?new Uint8Array(await r.arrayBuffer()):null}catch(e){return null}}
async function withTimeout(p,ms){let t;try{return await Promise.race([p,new Promise((_,r)=>t=setTimeout(()=>r(new Error("timeout")),ms))])}finally{clearTimeout(t)}}
async function allSettledValues(tasks,ms=SOURCE_TIMEOUT){const r=await Promise.allSettled(tasks.map(x=>withTimeout(Promise.resolve().then(x),ms)));return r.filter(x=>x.status==="fulfilled").map(x=>x.value).filter(Boolean)}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function uniq(a){return[...new Set((a||[]).filter(Boolean).map(String))]}
function norm(s){return String(s||"").toLowerCase().normalize?String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,""):String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"")}
function titleScore(a,b){const x=norm(a),y=norm(b);if(!x||!y)return 0;if(x===y)return 100;if(x.includes(y)||y.includes(x))return 80;const A=new Set(x.match(/.{1,4}/g)||[]),B=new Set(y.match(/.{1,4}/g)||[]);let n=0;for(const q of A)if(B.has(q))n++;return Math.round(60*n/Math.max(A.size,B.size))}
function cleanUrl(u){return String(u||"").replace(/&amp;/g,"&").trim()}
function isDub(s){return /\b(?:dub|dubbed|dual[\s-]*audio|multi[\s-]*audio|hindi[\s-]*dub|spanish[\s-]*dub|english[\s-]*dub|german[\s-]*dub)\b/i.test(String(s||""))}
function isSoft(s){return /\bsoft[\s-]*sub(?:bed)?\b|selectable[\s-]+subtitle|subtitle[\s-]+track/i.test(String(s||""))}
function isHardCategory(s){return /^(?:hardsub|hard-sub|hsub|h[\s-]?sub)$/i.test(String(s||"").trim())}
function explicitQuality(v){
  const s=String(v||"").toLowerCase();
  const m=s.match(/(?:2160|1440|1080|720|480|360|240)\s*p?/);return m?parseInt(m[1],10):0
}
function maxHeightFromPlaylist(s){
  let max=0,m;const re=/#EXT-X-STREAM-INF:([^\r\n]+)/gi;
  while((m=re.exec(String(s||"")))){const a=m[1];const r=/RESOLUTION=\s*\d+\s*x\s*(\d+)/i.exec(a);if(r)max=Math.max(max,Number(r[1]));}
  return max
}
async function inspectHls(url,headers,meta={}){
  const h=await text(url,{headers},HLS_TIMEOUT);if(!h)return null;
  const max=maxHeightFromPlaylist(h);
  if(max>=1080)return{url,max,master:true};
  const explicit=Math.max(explicitQuality(meta.quality),explicitQuality(meta.resolution),explicitQuality(meta.height),explicitQuality(meta.label),explicitQuality(meta.title));
  if(max===0&&explicit>=1080)return{url,max:explicit,master:false};
  return null
}
function hostForSource(source){
  const s=String(source||"").toLowerCase();
  if(s.startsWith("megaplay/"))return"https://megaplay.buzz";
  if(s.startsWith("vidwish/"))return"https://vidwish.live";
  if(s.startsWith("vidtube/"))return"https://vidtube.site";
  return null
}
function pageForSource(source){const proxy=STATE.proxyParam||PROXY_PARAM;return BASE+"/video/"+String(source||"")+"-"+proxy+"-en"}

function b64std(a){const abc="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",u=a instanceof Uint8Array?a:new Uint8Array(a),o=[];for(let i=0;i<u.length;i+=3){const x=u[i],y=i+1<u.length?u[i+1]:0,z=i+2<u.length?u[i+2]:0;o.push(abc[x>>2],abc[((x&3)<<4)|(y>>4)],i+1<u.length?abc[((y&15)<<2)|(z>>6)]:"=",i+2<u.length?abc[z&63]:"=")}return o.join("")}
function hexEncode(s){let o="";for(let i=0;i<s.length;i++)o+=s.charCodeAt(i).toString(16).padStart(2,"0");return o}
function shiftCipher(data,mode,shifts,key){
  if(!key)return data;const len=key.length;let s=String(data);
  for(let n=0;n<shifts;n++){let out="";for(let i=0;i<s.length;i++){const c=s.charAt(i),pos=key.indexOf(c);if(pos<0)out+=c;else{const w=((mode==="enc"?pos+5:pos-5+len)%len);out+=key.charAt(w)}}s=out.split("").reverse().join("")}return s
}
function chunk25(s){const out=[];for(let i=0;i<String(s).length;i+=25)out.push(String(s).slice(i,i+25));return out}
function shufflePairs(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)),t=a[i];a[i]=a[j];a[j]=t}return a}
function encryptData(data,key){const b=utf8enc(String(data)),hex=hexEncode(b64std(b));const n1=Math.floor(Math.random()*10)+1,s1=shiftCipher(hex,"enc",n1,key)+"strSMCconvert"+n1,n2=Math.floor(Math.random()*10)+1;return shiftCipher(s1,"enc",n2,key)}
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
function aesCbcDec(data,key,iv){if(data.length%16)throw new Error("Invalid AES ciphertext");const o=new Uint8Array(data.length);let prev=iv.slice();for(let p=0;p<data.length;p+=16){const b=aesDecBlock(data.slice(p,p+16),key);for(let i=0;i<16;i++)o[p+i]=b[i]^prev[i];prev=data.slice(p,p+16)}const pad=o[o.length-1];if(!pad||pad>16)throw new Error("Invalid PKCS7 padding");for(let i=o.length-pad;i<o.length;i++)if(o[i]!==pad)throw new Error("Invalid PKCS7 padding");return o.slice(0,o.length-pad)}

function utf8enc(s){const e=encodeURIComponent(String(s)),a=[];for(let i=0;i<e.length;){if(e[i]==="%"){a.push(parseInt(e.slice(i+1,i+3),16));i+=3}else a.push(e.charCodeAt(i++))}return new Uint8Array(a)}
const SHA_K=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];
const SHA_H=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];
function sha256(m){const a=m instanceof Uint8Array?m:utf8enc(m),l=a.length,n=(((l+9+63)>>6)<<6),b=new Uint8Array(n);b.set(a);b[l]=128;const bits=l*8;for(let i=0;i<8;i++)b[n-1-i]=(bits/(2**(8*i)))&255;let h=SHA_H.slice();const w=new Uint32Array(64);for(let p=0;p<n;p+=64){for(let i=0;i<16;i++)w[i]=(b[p+4*i]<<24)|(b[p+4*i+1]<<16)|(b[p+4*i+2]<<8)|b[p+4*i+3];for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2],s0=((x>>>7)|(x<<25))^((x>>>18)|(x<<14))^(x>>>3),s1=((y>>>17)|(y<<15))^((y>>>19)|(y<<13))^(y>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0}let[a0,a1,a2,a3,a4,a5,a6,a7]=h;for(let i=0;i<64;i++){const S1=((a4>>>6)|(a4<<26))^((a4>>>11)|(a4<<21))^((a4>>>25)|(a4<<7)),ch=(a4&a5)^(~a4&a6),t1=(a7+S1+ch+SHA_K[i]+w[i])>>>0,S0=((a0>>>2)|(a0<<30))^((a0>>>13)|(a0<<19))^((a0>>>22)|(a0<<10)),maj=(a0&a1)^(a0&a2)^(a1&a2),t2=(S0+maj)>>>0;a7=a6;a6=a5;a5=a4;a4=(a3+t1)>>>0;a3=a2;a2=a1;a1=a0;a0=(t1+t2)>>>0}h[0]=(h[0]+a0)>>>0;h[1]=(h[1]+a1)>>>0;h[2]=(h[2]+a2)>>>0;h[3]=(h[3]+a3)>>>0;h[4]=(h[4]+a4)>>>0;h[5]=(h[5]+a5)>>>0;h[6]=(h[6]+a6)>>>0;h[7]=(h[7]+a7)>>>0}const o=new Uint8Array(32);for(let i=0;i<8;i++){o[4*i]=h[i]>>>24;o[4*i+1]=h[i]>>>16;o[4*i+2]=h[i]>>>8;o[4*i+3]=h[i]}return o}
function hmac256(key,msg){let k=utf8enc(key),m=msg instanceof Uint8Array?msg:utf8enc(msg);if(k.length>64)k=sha256(k);const p=new Uint8Array(64),q=new Uint8Array(64);p.fill(54);q.fill(92);for(let i=0;i<k.length;i++){p[i]^=k[i];q[i]^=k[i]}const z=new Uint8Array(p.length+m.length);z.set(p);z.set(m,p.length);const ih=sha256(z),z2=new Uint8Array(q.length+ih.length);z2.set(q);z2.set(ih,q.length);return sha256(z2)}

function _gzipInflate(bytes){
  const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(a.length<18||a[0]!==31||a[1]!==139||a[2]!==8)throw new Error("Invalid gzip");
  let p=10,fl=a[3];
  if(fl&4){if(p+2>a.length)throw new Error("Bad gzip");const n=a[p]|a[p+1]<<8;p+=2+n}
  if(fl&8){while(p<a.length&&a[p++]){}}
  if(fl&16){while(p<a.length&&a[p++]){}}
  if(fl&2)p+=2;
  if(p>=a.length-8)throw new Error("Bad gzip body");
  const end=a.length-8,src=a.slice(p,end);
  let bit=0,idx=0,out=[];
  function rb(n){let v=0,s=0;while(s<n){if(idx>=src.length)throw new Error("Deflate EOF");const avail=8-bit,take=Math.min(n-s,avail),mask=(1<<take)-1;v|=((src[idx]>>bit)&mask)<<s;bit+=take;s+=take;if(bit===8){bit=0;idx++}}return v}
  function align(){if(bit){bit=0;idx++}}
  function rev(x,n){let r=0;for(let i=0;i<n;i++){r=(r<<1)|(x&1);x>>>=1}return r}
  function tree(lengths){
    let max=0;for(const n of lengths)if(n>max)max=n;
    const count=new Int32Array(max+1);for(const n of lengths)if(n)count[n]++;
    const next=new Int32Array(max+1);let code=0;
    for(let n=1;n<=max;n++){code=(code+count[n-1])<<1;next[n]=code}
    const maps=new Array(max+1);for(let n=0;n<=max;n++)maps[n]=Object.create(null);
    for(let sym=0;sym<lengths.length;sym++){const n=lengths[sym];if(!n)continue;const c=next[n]++;maps[n][rev(c,n)]=sym}
    return {max,maps}
  }
  function sym(t){let c=0;for(let n=1;n<=t.max;n++){c|=rb(1)<<(n-1);const s=t.maps[n][c];if(s!==undefined)return s}throw new Error("Bad Huffman")}
  const fixedLL=(()=>{const l=new Uint8Array(288);for(let i=0;i<=143;i++)l[i]=8;for(let i=144;i<=255;i++)l[i]=9;for(let i=256;i<=279;i++)l[i]=7;for(let i=280;i<288;i++)l[i]=8;return tree(l)})();
  const fixedD=tree(new Uint8Array(32).fill(5));
  const lbase=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const lext=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const dbase=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const dext=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  const corder=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
  function dynamic(){
    const hl=rb(5)+257,hd=rb(5)+1,hc=rb(4)+4,cl=new Uint8Array(19);
    for(let i=0;i<hc;i++)cl[corder[i]]=rb(3);
    const ct=tree(cl),lens=[];
    while(lens.length<hl+hd){const s=sym(ct);if(s<16)lens.push(s);else if(s===16){if(!lens.length)throw new Error("Bad repeat");const n=rb(2)+3,v=lens[lens.length-1];for(let i=0;i<n;i++)lens.push(v)}
      else if(s===17){const n=rb(3)+3;for(let i=0;i<n;i++)lens.push(0)}
      else if(s===18){const n=rb(7)+11;for(let i=0;i<n;i++)lens.push(0)}
      else throw new Error("Bad code length")}
    return [tree(lens.slice(0,hl)),tree(lens.slice(hl,hl+hd))]
  }
  let last=0;
  while(!last){
    last=rb(1);const type=rb(2);
    if(type===0){align();const n=rb(16),nn=rb(16);if(((n^0xffff)&0xffff)!==nn)throw new Error("Bad stored block");for(let i=0;i<n;i++)out.push(rb(8));continue}
    let lt,dt;if(type===1){lt=fixedLL;dt=fixedD}else if(type===2)[lt,dt]=dynamic();else throw new Error("Reserved deflate block");
    for(;;){const s=sym(lt);if(s<256){out.push(s);continue}if(s===256)break;if(s>285)throw new Error("Bad length");
      const li=s-257,n=lbase[li]+(lext[li]?rb(lext[li]):0),ds=sym(dt);if(ds>29)throw new Error("Bad distance");
      const dist=dbase[ds]+(dext[ds]?rb(dext[ds]):0),start=out.length-dist;if(start<0)throw new Error("Bad distance range");
      for(let i=0;i<n;i++)out.push(out[start+i])
    }
  }
  return new Uint8Array(out)
}

function makePayload(dataObj,key){
  const encStr=encryptData(JSON.stringify(dataObj),key),pairs=chunk25(encStr).map((chunk,i)=>[i,chunk]);
  shufflePairs(pairs);const data=[],ids=[];
  for(const p of pairs){ids.push(p[0]);data.push(p[1])}
  const token=encryptData(String(Math.floor(Date.now()/1000)+STATE.timeOffset+500),key);
  let auth=0;for(let i=0;i<token.length;i++)auth+=token.charCodeAt(i);
  return[{data,key:ids,token,authenticator:String(auth)},String(auth)]
}
const STATE={key:null,mark:null,timeOffset:0,snatchToken:null,proxyParam:null,initPromise:null};
async function initCrypto(){
  if(STATE.key&&STATE.mark)return;
  if(STATE.initPromise)return STATE.initPromise;
  STATE.initPromise=(async()=>{
    const html=await text(BASE+"/home",{headers:{"User-Agent":UA}},TIMEOUT);if(!html)throw new Error("AniSnatch /home failed");
    const cm=/configToken\s*=\s*['"]([^'"]+)['"]/.exec(html),tm=/serverTime\s*=\s*(\d+)/.exec(html),vm=/version\s*=\s*['"]([^'"]+)['"]/.exec(html);
    const mm=/<meta\s+name=['"]token['"]\s+content=['"]([^'"]+)['"]/.exec(html)||/content=['"]([^'"]+)['"]\s+name=['"]token['"]/.exec(html);
    if(!cm||!tm||!vm||!mm)throw new Error("AniSnatch crypto bootstrap incomplete");
    const fullKey=utf8enc(mm[1]+vm[1]+tm[1]),raw=b64dec(cm[1]),x=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)x[i]=raw[i]^fullKey[i%fullKey.length];
    const cfg=JSON.parse(utf8(x));STATE.key=String(cfg.key||"");STATE.mark=cfg.mark?Uint8Array.from(cfg.mark.map(Number)):null;
    STATE.timeOffset=Number(tm[1])-Math.floor(Date.now()/1000);
    STATE.proxyParam=cfg.proxys&&typeof cfg.proxys==="object"?Object.keys(cfg.proxys).join("~"):"";
    if(!STATE.key||!STATE.mark||!STATE.mark.length)throw new Error("AniSnatch crypto config invalid");
  })().finally(()=>{STATE.initPromise=null});return STATE.initPromise
}
async function responseBytes(r){
  if(r&&typeof r.arrayBuffer==="function"){
    try{return new Uint8Array(await r.arrayBuffer())}catch(e){log("arrayBuffer failed: "+(e&&e.message||e))}
  }
  if(r&&typeof r.bytes==="function"){
    try{const b=await r.bytes();return b instanceof Uint8Array?b:new Uint8Array(b)}catch(e){log("bytes failed: "+(e&&e.message||e))}
  }
  if(r&&typeof r.blob==="function"){
    try{const b=await r.blob();if(b&&typeof b.arrayBuffer==="function")return new Uint8Array(await b.arrayBuffer())}catch(e){log("blob failed: "+(e&&e.message||e))}
  }
  throw new Error("Nuvio response has no binary reader")
}
async function postAjax(endpoint,dataObj,referer){
  await initCrypto();
  const [payload,authenticator]=makePayload(dataObj,STATE.key);
  const url=BASE+"/api/"+endpoint+"/"+Math.floor(Date.now()/1000+STATE.timeOffset);
  const headers={"User-Agent":UA,"Content-Type":"application/json","X-Requested-With":"XMLHttpRequest","Referer":referer||BASE+"/home"};
  log(`POST ${url}`);const r=await req(url,{method:"POST",headers,body:JSON.stringify(payload)},TIMEOUT);if(!r||!r.ok)throw new Error(`AniSnatch API HTTP ${r?r.status:"NO_RESPONSE"}`);
  const resp=await responseBytes(r),mark=STATE.mark;log("API response bytes="+resp.length);let pos=-1;
  outer:for(let i=0;i<=resp.length-mark.length;i++){for(let j=0;j<mark.length;j++)if(resp[i+j]!==mark[j])continue outer;pos=i+mark.length;break}
  if(pos<0){let preview="";try{preview=await r.clone().text()}catch(e){}throw new Error("AniSnatch marker not found; response="+preview.slice(0,160))}
  const enc=resp.slice(pos),auth=utf8enc(authenticator),xored=new Uint8Array(enc.length);
  for(let i=0;i<enc.length;i++)xored[i]=enc[i]^auth[i%auth.length];
  const plain=_gzipInflate(xored),parsed=JSON.parse(utf8(plain));log("API decoded "+endpoint+" keys="+Object.keys(parsed||{}).join(","));return parsed
}
async function getSnatchToken(){
  if(STATE.snatchToken)return STATE.snatchToken;
  const r=await postAjax("init",{token:null},null);if(!r||r.success!==true||!(r.id||r.token))throw new Error("AniSnatch token unavailable");
  STATE.snatchToken=String(r.id||r.token);if(r.proxys&&typeof r.proxys==="object")STATE.proxyParam=Object.keys(r.proxys).join("~");return STATE.snatchToken
}
async function lazyMapping(tmdbId,season,episode){
  try{
    const u=MAPPING_URL+"?tmdbId="+encodeURIComponent(tmdbId)+"&tmdb_id="+encodeURIComponent(tmdbId)+"&season="+encodeURIComponent(season)+"&episode="+encodeURIComponent(episode)+"&pending=1";
    const d=await json(u,{},7000);if(!d||!d.mapping)return null;const m=d.mapping,mal=String(m.mal_id||m.malId||"").trim(),ep=Number(m.mal_episode||m.target_episode||0);
    if(!mal||!Number.isInteger(ep)||ep<1)return null;
    return{malId:mal,malEpisode:ep,title:String(m.anime_title||m.title||"").trim(),titles:Array.isArray(m.titles)?m.titles.filter(Boolean).map(String):[],source:d.source||"lazy"}
  }catch(e){return null}
}
async function tmdbTitle(id,type){
  try{const p=String(type).toLowerCase()==="movie"?"movie":"tv",d=await json("https://api.themoviedb.org/3/"+p+"/"+encodeURIComponent(id)+"?api_key="+encodeURIComponent(TMDB_KEY),{},3500);if(!d)return null;return{title:String(d.name||d.title||"").trim(),titles:uniq([d.original_name,d.original_title])}}catch(e){return null}
}
async function findAniSnatch(titleData){
  const qs=uniq([titleData&&titleData.title,...(titleData&&titleData.titles||[])]).filter(Boolean).slice(0,5);
  if(!qs.length)return null;
  const results=await allSettledValues(qs.map(q=>async()=>{try{const r=await postAjax("quickSearch",{keyword:q},null);const a=r&&r.data&&Array.isArray(r.data.anime)?r.data.anime:Array.isArray(r&&r.anime)?r.anime:Array.isArray(r&&r.data)?r.data:[];return a.filter(x=>x&&typeof x==="object")}catch(e){log(`quickSearch failed: ${e&&e.message||e}`);return[]}}),5000);
  const all=[];for(const a of results)for(const x of a)if(x&&!all.some(y=>String(y.id||"")===String(x.id||"")))all.push(x);
  if(!all.length)return null;
  let best=null,score=-1;for(const x of all){const names=uniq([x.title_en,x.title,x.name,x.al,...(Array.isArray(x.titles)?x.titles:[]),...(Array.isArray(x.al)?x.al:[])]);const s=Math.max(...names.map(y=>titleScore(titleData.title,y)),0);if(s>score){score=s;best=x}}
  const aniId=best&&best.id!=null?best.id:(best&&best.al!=null?best.al:null);if(aniId==null)return null;
  return{aniId:String(aniId),title:String(best.title_en||best.title||best.name||titleData.title),score}
}
function normalizeServerArray(v){return Array.isArray(v)?v.filter(x=>x&&typeof x==="object"):[]}
async function loadServers(aniId,episode,token){
  const r=await postAjax("loadSVs",{id:Number(aniId)||aniId,ep:Number(episode),token},null);
  if(!r||r.success!==true||!r.server||typeof r.server!=="object")return[];
  const out=[];
  for(const category of ["HSub","hardsub","hard-sub","hsub"]){
    const arr=normalizeServerArray(r.server[category]);for(const x of arr)out.push({...x,_category:category})
  }
  const seen=new Set();return out.filter(x=>{const k=String(x.source||"")+"|"+String(x.title||"");if(seen.has(k))return false;seen.add(k);return true})
}
function signAniSnatchUrl(url){
  try{
    if(/token=/i.test(url))return url;const m=/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i.exec(url);if(!m)return url;
    const payload=(Math.floor(Date.now()/1000)+90)+"|"+m[1]+"/"+m[2],sig=hmac256("MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s",utf8enc(payload));
    return url+(url.includes("?")?"&":"?")+"token="+b64url(utf8enc(payload))+"."+b64url(sig)
  }catch(e){return url}
}
function decryptSource(enc){
  try{
    const key=new Uint8Array(32);key.set(utf8enc("i?LMTAx0Q6,:}50U"));const iv=utf8enc("W0;27ToaUpl_P%'c"),p=aesCbcDec(b64dec(String(enc).replace(/-/g,"+").replace(/_/g,"/")),key,iv),o=JSON.parse(utf8(p));
    return o&&typeof o.file==="string"?o.file:null
  }catch(e){return null}
}
async function resolveExternal(server){
  const source=String(server.source||"").trim(),host=hostForSource(source);if(!host)return[];
  const page=pageForSource(source),pageHeaders={"Referer":BASE+"/","Accept":"*/*"},ajaxHeaders={"User-Agent":UA,"Accept":"*/*","X-Requested-With":"XMLHttpRequest","Origin":host,"Referer":page},playbackHeaders={"User-Agent":UA,"Referer":host+"/"};
  const html=await text(page,{headers:pageHeaders},SOURCE_TIMEOUT);if(!html)return[];
  let streamId=null,m=/data-id=['"](\d+)['"]/i.exec(html);if(m)streamId=m[1];if(!streamId)m=/data-realid=['"](\d+)['"]/i.exec(html);if(m)streamId=m&&m[1];if(!streamId){m=/\/stream\/s-\d+\/(\d+)/i.exec(page);if(m)streamId=m[1]}
  if(!streamId)return[];
  const endpoints=host.includes("megaplay.buzz")?["/stream/getSourcesNew","/stream/getSources"]:["/stream/getSources","/stream/getSourcesNew"];
  for(const ep of endpoints){
    const r=await json(host+ep+"?id="+encodeURIComponent(streamId)+"&type="+encodeURIComponent("sub"),{headers:ajaxHeaders},SOURCE_TIMEOUT);if(!r)continue;
    let file=null;if(r.sources&&typeof r.sources==="object"&&!Array.isArray(r.sources))file=r.sources.file;else if(Array.isArray(r.sources)&&r.sources[0])file=r.sources[0].file;
    if(!file&&r.file)file=r.file;if(!file&&r.enc)file=decryptSource(r.enc);
    file=cleanUrl(file);if(!file||!/^https?:\/\//i.test(file))continue;
    const signed=signAniSnatchUrl(file),qualityMeta={...server,...r};
    const h=await inspectHls(signed,playbackHeaders,qualityMeta);if(!h)continue;
    let subtitles=[];const tracks=Array.isArray(r.tracks)?r.tracks:[];for(const t of tracks){if(!t||!/^(captions|subtitles)$/i.test(String(t.kind||"")))continue;const u=cleanUrl(t.file);if(!/^https?:\/\//i.test(u))continue;subtitles.push({url:u,name:String(t.label||"English"),language:"en",format:String(t.format||"vtt").replace(/^\./,"")||"vtt",default:true,headers:playbackHeaders})}
    const label=String(server.title||"AniSnatch"),name=String(host).includes("megaplay")?"MegaPlay":String(host).includes("vidtube")?"VidTube":"VidWish";
    return[{name:name+" [HSub]",title:label+" [HSub]",url:h.url,quality:String(h.max)+"p",headers:playbackHeaders,subtitle:subtitles[0]?subtitles[0].url:"",subtitleFormat:subtitles[0]?subtitles[0].format:"",subtitles,backup:false,_source:name}]
  }
  return[]
}
async function fallbackTitle(tmdbId,type){return await tmdbTitle(tmdbId,type)}
async function getStreams(tmdbId,mediaType="tv",season=1,episode=1,settings={}){
  try{
    const id=String(tmdbId||"").trim();if(!id)return[];
    const s=Number(season)||1,e=Number(episode)||1,type=String(mediaType||"tv").toLowerCase();
    let mapped=await lazyMapping(id,s,e),titleData=mapped;
    if(!titleData){titleData=await fallbackTitle(id,type);if(!titleData)return[]}
    const ani=await findAniSnatch(titleData);if(!ani)return[];
    let token;try{token=await getSnatchToken()}catch(err){log("Token failed: "+err.message);return[]}
    let servers=await loadServers(ani.aniId,mapped?mapped.malEpisode:e,token);
    if(!servers.length){STATE.snatchToken=null;try{token=await getSnatchToken();servers=await loadServers(ani.aniId,mapped?mapped.malEpisode:e,token)}catch(err){}}
    if(!servers.length)return[];
    const valid=await allSettledValues(servers.map(srv=>async()=>{
      const context=[srv.title,srv.source,srv._category].join(" ");
      if(!isHardCategory(srv._category)||isDub(context)||isSoft(context))return[];
      return await resolveExternal(srv)
    }),SOURCE_TIMEOUT);
    const out=[];for(const a of valid)for(const x of a||[])if(x&&x.url&&!isDub(x.title)&&!isSoft(x.title)&&!out.some(y=>y.url===x.url))out.push(x);
    return out
  }catch(e){log("Provider failed: "+(e&&e.message||e));return[]}
}
module.exports={getStreams};
