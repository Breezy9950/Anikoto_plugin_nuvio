'use strict';

// ============================================================
// SPEED LAYER: dedupe fetches + 10s timeout per request
// ============================================================
const _origFetch = globalThis.fetch;
const _fetchCache = new Map();
const TIMEOUT_MS = 10000;

globalThis.fetch = function cachedFetch(url, opts) {
    const method = (opts && opts.method) || 'GET';
    const headers = (opts && opts.headers) || {};
    let key;
    try { key = method + ' ' + url + ' ' + JSON.stringify(headers); }
    catch { key = method + ' ' + url; }

    if (_fetchCache.has(key)) return _fetchCache.get(key);

    let tid = null;
    const p = Promise.race([
        _origFetch(url, opts).then(r => { if (tid) clearTimeout(tid); return r; }),
        new Promise((_, rej) => {
            tid = setTimeout(() => rej(new Error('fetch timeout: ' + url)), TIMEOUT_MS);
        })
    ]);
    _fetchCache.set(key, p);
    p.catch(() => _fetchCache.delete(key));
    return p;
};

// ============================================================
// IMPORTS / CONFIG
// ============================================================
const cheerio = require('cheerio-without-node-native');

const PROVIDER_NAME = '4KHDHub';
const BASE_URL = 'https://4khdhub.one';
const TMDB_URL = 'https://api.themoviedb.org/3';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': USER_AGENT, 'Referer': BASE_URL + '/' };

// ============================================================
// SORT TAG (zero-width prefix trick, floats best to top)
// ============================================================
function getInvertedSortTag(value, max = 999999) {
    const clamped = Math.max(0, parseInt(value, 10) || 0);
    const inverted = Math.max(0, max - clamped);
    const binary = inverted.toString(2).padStart(20, '0');
    return binary.split('').map(b => b === '1' ? '\ufeff' : '\u200b').join('');
}

// ============================================================
// SETTINGS
// ============================================================
function resolveSettings(input) {
    let s = { sortBy: 'quality' };
    try {
        let settings = input;
        if (!settings && typeof globalThis !== 'undefined')
            settings = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
        if (!settings && typeof global !== 'undefined')
            settings = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
        if (!settings && typeof window !== 'undefined')
            settings = window.SCRAPER_SETTINGS || window.settings;

        if (settings) {
            let raw = settings.sortBy || settings.sort_by || settings.sort || '';
            if (typeof raw === 'object' && raw !== null)
                raw = raw.value || raw.key || '';
            const val = String(raw).toLowerCase();
            if (val.includes('size') || val.includes('largest')) s.sortBy = 'size';
            else s.sortBy = 'quality';
        }
    } catch (e) {
        console.error(`[${PROVIDER_NAME}] settings error`, e);
    }
    return s;
}

function onSettings() {
    return [{
        type: 'select',
        key: 'sortBy',
        name: 'sort_by',
        label: 'Sort By',
        options: [
            { label: 'Quality', value: 'quality' },
            { label: 'Size', value: 'size' }
        ],
        default: 'quality'
    }];
}

// ============================================================
// FETCH / URL HELPERS
// ============================================================
async function fetchText(url, referer = BASE_URL) {
    const res = await fetch(url, {
        headers: { ...HEADERS, 'Referer': referer + '/' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return res.text();
}

function absoluteUrl(url, base = BASE_URL) {
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    try { return new URL(url, base).toString(); } catch { return ''; }
}

// ============================================================
// DECODERS
// ============================================================
function decodeBase64(input) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
    const s = String(input || '').replace(/=+$/, '');
    let out = '';
    let block = 0, accum;
    for (let i = 0, ch; (ch = s.charAt(i++)); ) {
        ch = chars.indexOf(ch);
        if (ch < 0) continue;
        accum = block % 4 ? accum * 64 + ch : ch;
        if (block++ % 4) out += String.fromCharCode((accum >> (-2 * block & 6)) & 0xff);
    }
    return out;
}

function rot13(input) {
    return String(input || '').replace(/[a-zA-Z]/g, c => {
        const code = c.charCodeAt(0) + 13;
        const limit = c <= 'Z' ? 90 : 122;
        return String.fromCharCode(code <= limit ? code : code - 26);
    });
}

function decodeEntities(input) {
    if (!input) return '';
    const map = { nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', '#038': '&' };
    return input
        .replace(/&(nbsp|amp|quot|lt|gt|#038);/g, (_, k) => map[k])
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}

// ============================================================
// TITLE MATCHING
// ============================================================
function normalizeTitle(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/\[[^\]]*]/g, ' ')
        .replace(/\b(the|a|an|directors?|cut)\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function titleScore(a, b) {
    const aTokens = normalizeTitle(a).split(' ').filter(Boolean);
    const bTokens = new Set(normalizeTitle(b).split(' ').filter(Boolean));
    if (!aTokens.length) return 0;
    const matched = aTokens.filter(t => bTokens.has(t)).length;
    return matched / aTokens.length;
}

// ============================================================
// QUALITY / SIZE PARSING
// ============================================================
function parseQuality(str) {
    const s = String(str || '').toLowerCase();
    if (s.includes('2160') || s.includes('4k')) return '2160p';
    if (s.includes('1080')) return '1080p';
    if (s.includes('720')) return '720p';
    if (s.includes('480')) return '480p';
    return '1080p';
}

function getQualityRank(q) {
    const s = String(q).toLowerCase();
    if (s.includes('2160') || s.includes('4k') || s.includes('uhd')) return 4;
    if (s.includes('1080') || s.includes('fhd')) return 3;
    if (s.includes('720') || s.includes('hd')) return 2;
    if (s.includes('480') || s.includes('sd')) return 1;
    return 0;
}

function parseSize(str) {
    const m = String(str || '').match(/([\d.]+)\s*(GB|MB|KB)/i);
    return m ? `${m[1]} ${m[2].toUpperCase()}` : 'N/A';
}

function isDirectVideo(url) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host.endsWith('.r2.dev') || host.endsWith('.r2.cloudflarestorage.com');
    } catch { return false; }
}

// ============================================================
// TMDB
// ============================================================
async function getMetadata(tmdbId, mediaType) {
    const kind = (mediaType === 'tv' || mediaType === 'series') ? 'tv' : 'movie';
    const res = await fetch(
        `${TMDB_URL}/${kind}/${encodeURIComponent(tmdbId)}?api_key=${TMDB_KEY}&append_to_response=external_ids`,
        { headers: { 'Accept': 'application/json', 'User-Agent': USER_AGENT } }
    );
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    const data = await res.json();
    const date = kind === 'tv' ? data.first_air_date : data.release_date;
    return {
        title: kind === 'tv' ? data.name : data.title,
        year: date ? Number(date.slice(0, 4)) : null
    };
}

// ============================================================
// SEARCH PAGE
// ============================================================
async function findPage(meta, isTv, season) {
    const query = isTv && season
        ? `${meta.title} season ${season}`
        : `${meta.title} ${meta.year || ''}`.trim();

    const html = await fetchText(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
    const $ = cheerio.load(html);
    let best = null;

    $('.card').each((_, el) => {
        const $el = $(el);
        const title = $el.find('.card-title').text().trim();
        const type = $el.find('.card-meta').text().trim();
        const metaText = $el.find('.card-body, .card-text, p').text();
        const href = $el.attr('href') || $el.find('a[href]').first().attr('href');
        if (!title || !href) return;
        if (isTv && !/series/i.test(type)) return;
        if (!isTv && !/movies?/i.test(type)) return;

        const ym = metaText.match(/\b(19|20)\d{2}\b/);
        const year = ym ? Number(ym[0]) : null;

        let score = titleScore(meta.title, title);
        if (meta.year && year === meta.year) score += 0.35;
        else if (meta.year && year && Math.abs(year - meta.year) > 1) score -= 0.5;

        if (isTv && season) {
            const sm = title.match(/(?:season\s*|s)(\d+)/i);
            if (sm && Number(sm[1]) === Number(season)) score += 0.4;
            else if (sm) score -= 0.6;
        }

        if (!best || score > best.score) {
            best = { url: absoluteUrl(href), score, title };
        }
    });

    return best && best.score >= 0.7 ? best.url : '';
}

// ============================================================
// HUB CLOUD RESOLUTION
// ============================================================
async function decodeRedirect(url) {
    if (/hubcloud|hubdrive/i.test(url)) return url;
    try {
        const html = await fetchText(url);
        const encoded =
            html.match(/['"]o['"]\s*,\s*['"]([^'"]+)['"]/)?.[1] ||
            html.match(/'o','([^']+)'/)?.[1];
        if (!encoded) return url;
        const json = JSON.parse(decodeBase64(rot13(decodeBase64(decodeBase64(encoded)))));
        return json.o ? decodeBase64(json.o).trim() : url;
    } catch { return url; }
}

async function findHubCloud($el, pageUrl, $) {
    const anchors = $el.find('a[href]').get();
    for (const a of anchors) {
        const $a = $(a);
        const href = $a.attr('href');
        const text = $a.text();
        if (!href) continue;
        if (/hubcloud/i.test(text) || /hubcloud/i.test(href)) {
            return decodeRedirect(absoluteUrl(href, pageUrl));
        }
        if (/hubdrive/i.test(text) || /hubdrive/i.test(href)) {
            const decoded = await decodeRedirect(absoluteUrl(href, pageUrl));
            try {
                const inner = await fetchText(decoded, pageUrl);
                const $inner = cheerio.load(inner);
                const link = $inner('a[href]').filter((_, el) => {
                    const $e = $inner(el);
                    return /hubcloud/i.test($e.text() + ' ' + ($e.attr('href') || ''));
                }).first().attr('href');
                if (link) return absoluteUrl(link, decoded);
            } catch {}
        }
    }
    return '';
}

async function extractHubCloud(url, meta) {
    try {
        let html = await fetchText(url, url);
        let currentUrl = url;

        const redirect = html.match(/var url\s*=\s*['"]([^'"]+)['"]/)?.[1]
            || cheerio.load(html)('a[href*="hubcloud"]').attr('href');

        if (redirect) {
            currentUrl = absoluteUrl(redirect, url);
            html = await fetchText(currentUrl, url);
        }

        const $ = cheerio.load(html);
        const title = $('div.card-header').text().replace(/\s+/g, ' ').trim()
            || $('title').text().trim()
            || meta.title;

        const parsedSize = parseSize($('.card-text, .card-body').first().text());
        const size = parsedSize !== 'N/A' ? parsedSize : meta.size;
        const quality = parseQuality(title);
        const out = [];

        $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            if (!href || !isDirectVideo(href)) return;
            out.push({ url: href, title, quality, size });
        });

        return out;
    } catch { return []; }
}

// ============================================================
// MAIN EXTRACTION
// ============================================================
async function extractStreams(pageUrl, isTv, season, episode) {
    const html = await fetchText(pageUrl);
    const $ = cheerio.load(html);
    const items = [];

    if (isTv && season && episode) {
        const seasonTag = 'S' + String(season).padStart(2, '0');
        const episodeTag = 'Episode-' + String(episode).padStart(2, '0');
        $('.episode-item').each((_, el) => {
            const $ep = $(el);
            if (!$ep.find('.episode-title, .episode-name').text().includes(seasonTag)) return;
            $ep.find('.episode-download-item').each((_, d) => {
                if ($(d).text().includes(episodeTag)) items.push($(d));
            });
        });
    } else {
        $('.download-item').each((_, d) => items.push($(d)));
    }

    const results = await Promise.all(items.map(async item => {
        const text = item.text().replace(/\s+/g, ' ').trim();
        const meta = {
            title: item.find('a[href]').text().trim() || text,
            quality: parseQuality(text),
            size: parseSize(text)
        };
        const hub = await findHubCloud(item, pageUrl, $);
        if (!hub) return [];
        return extractHubCloud(hub, meta);
    }));

    return results.flat();
}

// ============================================================
// BUILD RESULT — ShowBox-style description + "4KHDHub <quality>" name
// ============================================================
function buildStreamObject(metaTitle, link, rawUrl, qualityHint, sizeHint, headers, seasonEpisode, tmdbMeta, sortBy) {
    let url = '';
    try { url = decodeURIComponent(rawUrl || ''); } catch { url = rawUrl || ''; }

    const cleanLink = decodeEntities(link || '').replace(/[\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const combined = (cleanLink + ' ' + url).toLowerCase();

    // ---- Quality ----
    let quality = qualityHint;
    const qm = combined.match(/\b(2160p|4k|1080p|720p|480p)\b/i);
    if (qm) {
        const v = qm[1].toLowerCase();
        if (v === '4k' || v === '2160p') quality = '2160p';
        else if (v === '1080p') quality = '1080p';
        else if (v === '720p') quality = '720p';
        else if (v === '480p') quality = '480p';
    }
    if (!quality || quality === 'N/A') quality = parseQuality(combined);

    const qualityRank = getQualityRank(quality);

    // ---- Size ----
    let size = sizeHint && sizeHint !== 'N/A' ? sizeHint : 'N/A';
    const sm = cleanLink.match(/\[\s*(\d+(?:\.\d+)?\s*[MG]B)\s*]/i)
        || cleanLink.match(/(\d+(?:\.\d+)?\s*[MG]B)/i)
        || url.match(/(\d+(?:\.\d+)?\s*[MG]B)/i);
    if (sm) size = sm[1].toUpperCase().replace(/\s+/g, '');

    let sizeMB = 0;
    if (size !== 'N/A') {
        const m = size.match(/([\d.]+)\s*(GB|MB)/i);
        if (m) {
            const n = parseFloat(m[1]);
            sizeMB = Math.round(m[2].toUpperCase().includes('GB') ? n * 1024 : n);
        }
    }

    // ---- Source / Codec / HDR ----
    const source = /\b(bluray|blu-ray)\b/i.test(combined) ? 'BluRay' : 'WEB-DL';
    const codec = /\b(h\.?265|x265|hevc)\b/i.test(combined) ? 'H.265' : 'H.264';

    let hdrTag = '';
    if (/\bhdr10\+/i.test(combined)) hdrTag = 'HDR10+';
    else if (/\bhdr10\b/i.test(combined)) hdrTag = 'HDR10';
    else if (/\bhdr\b/i.test(combined)) hdrTag = 'HDR';

    const dvTag = (/\b(dolby\s*vision|dovi|\.dv\.)\b/i.test(combined)
        || /[.\-_]dv[.\-_]/i.test(combined)) ? 'DV' : '';

    // ---- Audio detection (only from real signals, no defaults) ----
    const audioParts = [];

    if (/\b(multi|multi-audio)\b/i.test(combined)) audioParts.push('Multi-Audio');
    else if (/\b(dual|dual-audio|dubbed|hindi)\b/i.test(combined)
             || decodeEntities(link || '').toLowerCase().includes('hindi'))
        audioParts.push('Dual-Audio');

    if (/\btruehd\s*7\.1\b/i.test(combined)) audioParts.push('TrueHD 7.1');
    else if (/\bddp5\.1\b/i.test(combined) || /\beac3\b/i.test(combined)) audioParts.push('DDP5.1');
    else if (/\bdd5\.1\b/i.test(combined)) audioParts.push('DD5.1');

    if (/\batmos\b/i.test(combined)) audioParts.push('Atmos');

    // ---- Sort tag ----
    const sortTag = sortBy === 'size'
        ? getInvertedSortTag(sizeMB)
        : getInvertedSortTag(qualityRank * 100000 + sizeMB);

    // ---- Short name: "4KHDHub 4K" / "4KHDHub 1080p" / "4KHDHub 720p" ----
    const qualityShort = quality === '2160p' ? '4K' : quality;
    const name = `${sortTag}${PROVIDER_NAME} ${qualityShort}`;

    // ---- Description (ShowBox style) ----
    const tmdbTitle = tmdbMeta && tmdbMeta.title
        ? tmdbMeta.title
        : (metaTitle || 'Unknown');
    const tmdbYear = tmdbMeta && tmdbMeta.year ? tmdbMeta.year : 'N/A';

    const seSuffix = (seasonEpisode && (seasonEpisode.startsWith('s') || seasonEpisode.startsWith('S') || seasonEpisode.includes('E')))
        ? ' ' + seasonEpisode.replace(/E0*(\d+)/i, 'E$1').replace(/S0*(\d+)/i, 'S$1')
        : '';
    const titleLine = `${tmdbTitle} (${tmdbYear})${seSuffix}`;

    const tagParts = [quality, source, codec];
    if (hdrTag) tagParts.push(hdrTag);
    if (dvTag) tagParts.push(dvTag);
    const tagLine = tagParts.join(' • ');

    const lines = [titleLine, tagLine];
    if (size !== 'N/A') lines.push(size);
    if (audioParts.length) lines.push(`Audio: ${audioParts.join(', ')}`);

    const description = lines.join('\n');

    return {
        qualityRank,
        sizeInMB: sizeMB,
        data: {
            name,
            title: description,
            size: description,
            description,
            url: rawUrl || '',
            behaviorHints: {
                notWebReady: true,
                proxyHeaders: {
                    request: headers || { Referer: BASE_URL + '/' }
                }
            }
        }
    };
}

// ============================================================
// ENTRY POINT
// ============================================================
async function getStreams(tmdbId, type, season = null, episode = null, settings = {}) {
    const isTv = type === 'tv' || type === 'series';
    if (!tmdbId || (!isTv && type !== 'movie')) return [];

    try {
        const resolved = resolveSettings(settings);
        console.log(`[${PROVIDER_NAME}] tmdb=${tmdbId} type=${type} S=${season} E=${episode} sort=${resolved.sortBy}`);

        const meta = await getMetadata(tmdbId, type);
        const pageUrl = await findPage(meta, isTv, season);
        if (!pageUrl) return [];

        const streams = await extractStreams(pageUrl, isTv, season, episode);

        let seasonEpisode = '';
        if (isTv) {
            const s = parseInt(season, 10) || 1;
            const e = parseInt(episode, 10) || 1;
            seasonEpisode = 'S' + (s < 10 ? '0' : '') + s + 'E' + (e < 10 ? '0' : '') + e;
        }

        const seen = {};
        const results = [];
        for (const s of streams) {
            if (!isDirectVideo(s.url) || seen[s.url]) continue;
            seen[s.url] = true;

            const label = `${s.title} [${s.size}] ${s.quality}`;
            const obj = buildStreamObject(
                meta.title,
                label,
                s.url,
                s.quality,
                s.size,
                { Referer: BASE_URL + '/', 'User-Agent': USER_AGENT },
                seasonEpisode.toLowerCase(),
                meta,
                resolved.sortBy
            );
            results.push(obj);
        }

        results.sort((a, b) => {
            if (resolved.sortBy === 'size') return b.sizeInMB - a.sizeInMB;
            if (b.qualityRank !== a.qualityRank) return b.qualityRank - a.qualityRank;
            return b.sizeInMB - a.sizeInMB;
        });

        console.log(`[${PROVIDER_NAME}] Returning ${results.length} stream(s) sorted by ${resolved.sortBy}`);
        return results.map(r => r.data);
    } catch (e) {
        console.error(`[${PROVIDER_NAME}] error: ${e.message}`);
        return [];
    }
}

module.exports = { getStreams, onSettings };
