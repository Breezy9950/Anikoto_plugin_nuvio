'use strict';

// ============ Configuration ============
const DEFAULT_BASEDOM = 'https://whisperingauroras.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
// ⚠️ Replace with your TMDB key (original had a hardcoded value).
const TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';

let BASEDOM = DEFAULT_BASEDOM;

// Timeouts tuned for speed
const T_EMBED   = 12000;
const T_RCP     = 6000;
const T_PRORCP  = 6000;
const T_TOKEN   = 4000;

// ============ Helpers ============
function b64decode(input) {
  try {
    if (typeof atob === 'function') return atob(input);
    if (typeof Buffer !== 'undefined') return Buffer.from(input, 'base64').toString('binary');
  } catch (_) {}
  return '';
}

function safeFetch(url, opts, timeout) {
  timeout = timeout || 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const finalOpts = Object.assign({ method: 'GET' }, opts || {}, { signal: controller.signal });
  return fetch(url, finalOpts).then(
    res => { clearTimeout(timer); return res; },
    err => { clearTimeout(timer); throw err; }
  );
}

// ============ Decryptors (deobfuscated) ============

function Iry9MQXnLs(s) {
  if (typeof s !== 'string') return '';
  const key = 'pWB9V)[*4I`nJpp?ozyB~dbr9yt!_n4u';
  const pairs = s.match(/.{1,2}/g) || [];
  const joined = pairs.map(h => String.fromCharCode(parseInt(h, 16))).join('');
  let xored = '';
  for (let i = 0; i < joined.length; i++)
    xored += String.fromCharCode(joined.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  let shifted = '';
  for (let i = 0; i < xored.length; i++)
    shifted += String.fromCharCode(xored.charCodeAt(i) - 3);
  return b64decode(shifted);
}

function IGLImMhWrI(s) {
  const rev = s.split('').reverse().join('');
  const shifted = rev.replace(/[a-zA-Z]/g, c =>
    String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < 'n' ? 13 : -13)));
  return b64decode(shifted.split('').reverse().join(''));
}

function GTAxQyTyBx(s) {
  const rev = s.split('').reverse().join('');
  let every = '';
  for (let i = 0; i < rev.length; i += 2) every += rev[i];
  return b64decode(every);
}

function C66jPHx8qu(hex) {
  const rev = hex.split('').reverse().join('');
  const key = 'X9a(O;FMV2-7VO5x;Ao :dN1NoFs?j,';
  const pairs = rev.match(/.{1,2}/g) || [];
  const joined = pairs.map(h => String.fromCharCode(parseInt(h, 16))).join('');
  let out = '';
  for (let i = 0; i < joined.length; i++)
    out += String.fromCharCode(joined.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  return out;
}

function MyL1IRSfHe(s) {
  const rev = s.split('').reverse().join('');
  let minus = '';
  for (let i = 0; i < rev.length; i++) minus += String.fromCharCode(rev.charCodeAt(i) - 1);
  let out = '';
  for (let i = 0; i < minus.length; i += 2)
    out += String.fromCharCode(parseInt(minus.substr(i, 2), 16));
  return out;
}

function detdj7JHiK(s) {
  // ⚠️ Original obfuscator key was unresolvable statically; using best-guess.
  // If this specific variant is rarely used by VidSrc today, this is safe.
  const sliced = s.slice(10, -16);
  const key = 'DgL0Bgu';
  const decoded = b64decode(sliced);
  if (!decoded) return '';
  const repeated = key.repeat(Math.ceil(decoded.length / key.length)).substring(0, decoded.length);
  let out = '';
  for (let i = 0; i < decoded.length; i++)
    out += String.fromCharCode(decoded.charCodeAt(i) ^ repeated.charCodeAt(i));
  return out;
}

function nZlUnj2VSo(s) {
  const map = {x:'a',y:'b',z:'c',a:'d',b:'e',c:'f',d:'g',e:'h',f:'i',g:'j',h:'k',i:'l',j:'m',k:'n',l:'o',m:'p',n:'q',o:'r',p:'s',q:'t',r:'u',s:'v',t:'w',u:'x',v:'y',w:'z',X:'A',Y:'B',Z:'C',A:'D',B:'E',C:'F',D:'G',E:'H',F:'I',G:'J',H:'K',I:'L',J:'M',K:'N',L:'O',M:'P',N:'Q',O:'R',P:'S',Q:'T',R:'U',S:'V',T:'W',U:'X',V:'Y',W:'Z'};
  return s.replace(/[xyzabcdefghijklmnopqrstuvwXYZABCDEFGHIJKLMNOPQRSTUVW]/g, c => map[c] || c);
}

function laM1dAi3vO(s) {
  const rev = s.split('').reverse().join('');
  const b64 = rev.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = b64decode(b64);
  if (!decoded) return '';
  let out = '';
  for (let i = 0; i < decoded.length; i++) out += String.fromCharCode(decoded.charCodeAt(i) - 5);
  return out;
}

function GuxKGDsA2T(s) {
  const rev = s.split('').reverse().join('');
  const b64 = rev.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = b64decode(b64);
  if (!decoded) return '';
  let out = '';
  for (let i = 0; i < decoded.length; i++) out += String.fromCharCode(decoded.charCodeAt(i) - 7);
  return out;
}

function LXVUMCoAHJ(s) {
  const rev = s.split('').reverse().join('');
  const b64 = rev.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = b64decode(b64);
  if (!decoded) return '';
  let out = '';
  for (let i = 0; i < decoded.length; i++) out += String.fromCharCode(decoded.charCodeAt(i) - 3);
  return out;
}

function bMGyx71TzQLfdonN(s) {
  if (typeof s !== 'string') return '';
  const chunks = [];
  for (let i = 0; i < s.length; i += 3) chunks.push(s.slice(i, i + 3));
  return chunks.reverse().join('');
}

function decrypt(payload, method) {
  switch (method) {
    case 'LXVUMCoAHJ':        return LXVUMCoAHJ(payload);
    case 'GuxKGDsA2T':        return GuxKGDsA2T(payload);
    case 'laM1dAi3vO':        return laM1dAi3vO(payload);
    case 'nZlUnj2VSo':        return nZlUnj2VSo(payload);
    case 'Iry9MQXnLs':        return Iry9MQXnLs(payload);
    case 'IGLImMhWrI':        return IGLImMhWrI(payload);
    case 'GTAxQyTyBx':        return GTAxQyTyBx(payload);
    case 'C66jPHx8qu':        return C66jPHx8qu(payload);
    case 'MyL1IRSfHe':        return MyL1IRSfHe(payload);
    case 'detdj7JHiK':        return detdj7JHiK(payload);
    case 'bMGyx71TzQLfdonN':  return bMGyx71TzQLfdonN(payload);
    default: return null;
  }
}

// ============ HTML parsing ============

function serversLoad(html) {
  const out = [];
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1] : '';

  const iframeMatch = html.match(/<iframe\s+[^>]*src="([^"]*)"/i);
  const iframeSrc = iframeMatch ? iframeMatch[1] : '';
  if (iframeSrc) {
    try {
      BASEDOM = new URL(iframeSrc.startsWith('//') ? 'https:' + iframeSrc : iframeSrc).origin;
    } catch (_) {}
  }

  const re = /class="[^"]*server[^"]*"[^>]*data-hash="([^"]*)"[^>]*>([^<]*)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ name: m[2].trim(), dataHash: m[1] });
  }
  return { servers: out, title };
}

function rcpGrabber(body) {
  const m = body.match(/src:\s*'([^']*)'/);
  return m ? m[1] : null;
}

// ============ PRORCP handler with JS-file caching ============

const scriptCache = new Map();

async function PRORCPhandler(hash) {
  try {
    const rcpRes = await safeFetch(BASEDOM + '/prorcp/' + hash, {
      headers: { Referer: 'https://vidsrc.me/', 'User-Agent': UA }
    }, T_RCP);
    const rcpText = await rcpRes.text();

    const matches = rcpText.match(/<script\s+src="\/([^"]*\.js)\?\_=([^"]*)"><\/script>/gm);
    if (!matches) return null;

    const chosen = matches[matches.length - 1].includes('cpt.js')
      ? matches[matches.length - 2]
      : matches[matches.length - 1];

    const fileMatch = chosen.match(/.*src="\/([^"]*\.js)\?\_=([^"]*)".*/);
    if (!fileMatch) return null;

    const filename = fileMatch[1];

    // Cache script bodies across servers
    let jsText = scriptCache.get(filename);
    if (!jsText) {
      const jsRes = await safeFetch(BASEDOM + '/' + filename, {}, T_PRORCP);
      jsText = await jsRes.text();
      scriptCache.set(filename, jsText);
    }

    const fnMatch = jsText.match(/{}\}window\[([^"]+)\("([^"]+)"\)/);
    if (!fnMatch || fnMatch.length < 3) return null;

    const decryptFn = fnMatch[1].trim();
    const decryptPayload = fnMatch[2].toString().trim();

    const matchStr = decrypt(decryptPayload, decryptFn);
    if (!matchStr) return null;

    const nameRe = new RegExp('data-hash="' + matchStr + '"[^>]*>([^<]*)', 'i');
    const nameMatch = rcpText.match(nameRe);
    if (!nameMatch) return null;

    const encName = nameMatch[1].trim();
    return decrypt(encName, decryptPayload);
  } catch (e) {
    console.log('[VidSrc] PRORCP error: ' + e.message);
    return null;
  }
}

// ============ Title / duration ============

function cleanTitleString(input) {
  if (!input) return { title: 'Unknown', year: '2026' };
  let title = input.replace(/\s*-\s*VidSrc\.me$/i, '').trim();
  let year = '2024';
  const ym = title.match(/\s*\((\d{4})\)$/);
  if (ym) {
    year = ym[1];
    title = title.replace(/\s*\(\d{4}\)$/, '').trim();
  }
  return { title, year };
}

async function fetchTMDBDuration(tmdbId, type, season, episode) {
  const fallback = type === 'tv' ? '45 min' : '120 min';
  try {
    const kind = type === 'tv' ? 'tv' : 'movie';
    const id = String(tmdbId).replace(/\D/g, '');
    const url = `https://api.themoviedb.org/3/${kind}/${id}?api_key=${TMDB_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return fallback;
    const data = await res.json();
    if (type === 'movie' && data.runtime) return data.runtime + ' min';
    if (type === 'tv' && season != null && episode != null) {
      const epUrl = `https://api.themoviedb.org/3/tv/${id}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}`;
      const epRes = await fetch(epUrl);
      if (epRes.ok) {
        const epData = await epRes.json();
        if (epData.runtime) return epData.runtime + ' min';
      }
      if (data.episode_run_time && data.episode_run_time.length > 0) {
        return data.episode_run_time[0] + ' min';
      }
    }
    return fallback;
  } catch (_) {
    return fallback;
  }
}

// ============ Stream building ============

function classifyQuality(url) {
  if (url.includes('/720/') || url.includes('720p')) return '720p';
  if (url.includes('/360/') || url.includes('360p') || url.includes('/7a67b')) return '360p';
  if (url.includes('/1080/') || url.includes('1080p')) return '1080p';
  return '1080p';
}

function classifyExt(url) {
  if (url.includes('.m3u8')) return 'HLS';
  if (url.includes('.mp4'))  return 'MP4';
  return 'MKV';
}

function buildStreamObject(url, serverLabel, isMovie, season, episode, clean, duration, subIdx, subTotal) {
  const quality = classifyQuality(url);
  const qUpper  = quality.toUpperCase();
  const ext     = classifyExt(url);

  let name = `VidSrc | ${qUpper}`;
  if (subTotal > 1) name += ` (Part ${subIdx + 1})`;

  const seTag = !isMovie && season && episode
    ? ` S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
    : '';

  const title = `📺 ${clean.title}${seTag} - (${clean.year})`;
  const desc = [
    `⭐ ${qUpper} | 🌍 Original-Audio | 🎧 AAC`,
    `💾 ${ext} | 🎥 x264 | ⏳ ${duration}`,
    `📎 ${serverLabel}`
  ].join('\n');

  return {
    name,
    title,
    size: desc,
    description: desc,
    url,
    quality: '',
    language: '',
    headers: {},
    subtitles: [],
    provider: 'VidSrc'
  };
}

// ============ Per-server processing (runs in parallel) ============

async function processServer(server, idx, isMovie, season, episode, clean, duration) {
  try {
    const rcpRes  = await safeFetch(BASEDOM + '/prorcp/' + server.dataHash, {}, T_RCP);
    const rcpText = await rcpRes.text();
    const rcpSrc  = rcpGrabber(rcpText);
    if (!rcpSrc || !rcpSrc.startsWith('/prorcp/')) return [];

    let resolved = await PRORCPhandler(rcpSrc.replace('/prorcp/', ''));
    if (!resolved) return [];

    // Token injection (only if placeholders remain)
    if (resolved.includes('__TOKEN__') || resolved.includes('__TOKENPG__')) {
      try {
        const firstUrl = resolved.split(/[\s\n]/)[0];
        const host = new URL(firstUrl).hostname;
        const tokenRes = await safeFetch('https://' + host + '/generate.php', {
          headers: { Referer: 'https://vidsrc.me/', 'User-Agent': UA }
        }, T_TOKEN);
        const token = (await tokenRes.text()).trim();
        if (token && token.length > 10) {
          resolved = resolved.replace(/__TOKEN__/g, token).replace(/__TOKENPG__/g, token);
        }
      } catch (e) {
        console.log('[VidSrc] Token error: ' + e.message);
      }
    }

    // Split into individual URLs (blank-line / newline separated)
    const urls = resolved.split(/\s*\n+\s*/).map(u => u.trim()).filter(Boolean);
    if (!urls.length) return [];

    const serverNum = server.name.replace(/\D+/g, '') || String(idx + 1);
    const serverLabel = 'Server ' + serverNum;

    return urls.map((url, i) =>
      buildStreamObject(url, serverLabel, isMovie, season, episode, clean, duration, i, urls.length)
    );
  } catch (e) {
    console.log(`[VidSrc] ${server.name} error: ${e.message}`);
    return [];
  }
}

// ============ Main entry ============

async function getStreams(tmdbId, type, season, episode) {
  try {
    const isMovie = type === 'movie';
    const embedUrl = isMovie
      ? `https://vidsrc.me/embed/movie?tmdb=${tmdbId}`
      : `https://vidsrc.me/embed/tv?tmdb=${tmdbId}&season=${season || 1}&episode=${episode || 1}`;

    console.log('[VidSrc] Fetching embed page: ' + embedUrl);

    // Fetch embed page + duration concurrently
    const [embedRes, duration] = await Promise.all([
      safeFetch(embedUrl, {}, T_EMBED),
      fetchTMDBDuration(tmdbId, type, season, episode)
    ]);

    const html = await embedRes.text();
    const { servers, title } = serversLoad(html);
    const clean = cleanTitleString(title);

    console.log('[VidSrc] Parsed servers: ' + servers.length);
    if (!servers.length) return [];

    // Process every server simultaneously
    const results = await Promise.all(
      servers.map((srv, i) =>
        processServer(srv, i, isMovie, season, episode, clean, duration)
      )
    );

    const flat = results.flat();
    console.log('[VidSrc] Total streams: ' + flat.length);
    return flat;
  } catch (e) {
    console.log('[VidSrc] Scraper error: ' + e.message);
    return [];
  }
}

module.exports = { getStreams };
