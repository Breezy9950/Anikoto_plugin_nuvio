"use strict";
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
var BASE_URL = "https://4khdhub.click";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
var domainCache = { url: BASE_URL, ts: 0 };

function fetchLatestDomain() {
  return __async(this, null, function* () {
    const now = Date.now();
    if (now - domainCache.ts < 36e5) return domainCache.url;
    try {
      const response = yield fetch(DOMAINS_URL);
      const data = yield response.json();
      if (data && data["4khdhub"]) {
        domainCache.url = data["4khdhub"];
        domainCache.ts = now;
      }
    } catch (e) {}
    return domainCache.url;
  });
}
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const retries = options.retries !== void 0 ? options.retries : 2;
    const delay = options.delay !== void 0 ? options.delay : 1e3;
    for (let i = 0; i <= retries; i++) {
      try {
        const response = yield fetch(url, {
          headers: __spreadValues({ "User-Agent": USER_AGENT }, options.headers)
        });
        return yield response.text();
      } catch (err) {
        console.log(`[4KHDHub] Request failed for ${url}: ${err.message}${i < retries ? `, retrying (${i + 1}/${retries})...` : ""}`);
      }
      if (i < retries) yield new Promise((r) => setTimeout(r, delay * Math.pow(2, i)));
    }
    return null;
  });
}
function getTmdbDetails(tmdbId, type) {
  return __async(this, null, function* () {
    const isSeries = type === "series" || type === "tv";
    const endpoint = isSeries ? "tv" : "movie";
    const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    console.log(`[4KHDHub] Fetching TMDB details from: ${url}`);
    try {
      const response = yield fetch(url);
      const data = yield response.json();
      if (isSeries) return { title: data.name, year: data.first_air_date ? parseInt(data.first_air_date.split("-")[0]) : 0 };
      return { title: data.title, year: data.release_date ? parseInt(data.release_date.split("-")[0]) : 0 };
    } catch (error) {
      console.log(`[4KHDHub] TMDB request failed: ${error.message}`);
      return null;
    }
  });
}
function atob(input) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let str = String(input).replace(/=+$/, "");
  if (str.length % 4 === 1) throw new Error("'atob' failed");
  let output = "";
  for (let bc = 0, bs, buffer, i = 0; buffer = str.charAt(i++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
    buffer = chars.indexOf(buffer);
  }
  return output;
}
function rot13Cipher(str) {
  return str.replace(/[a-zA-Z]/g, function(c) {
    return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
  });
}
function levenshteinDistance(s, t) {
  if (s === t) return 0;
  const n = s.length, m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const d = [];
  for (let i = 0; i <= n; i++) { d[i] = []; d[i][0] = i; }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
  }
  return d[n][m];
}
function parseBytes(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const match = val.match(/^([0-9.]+)\s*([a-zA-Z]+)$/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  let multiplier = 1;
  if (unit.indexOf("k") === 0) multiplier = 1024;
  else if (unit.indexOf("m") === 0) multiplier = 1024 * 1024;
  else if (unit.indexOf("g") === 0) multiplier = 1024 * 1024 * 1024;
  else if (unit.indexOf("t") === 0) multiplier = 1024 * 1024 * 1024 * 1024;
  return num * multiplier;
}
function formatBytes(val) {
  if (val === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  let i = Math.floor(Math.log(val) / Math.log(k));
  if (i < 0) i = 0;
  return parseFloat((val / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// ============================================================
// SETTINGS
// ============================================================
function onSettings() {
  return [
    {
      type: "select",
      key: "source",
      name: "source",
      label: "Preferred Source",
      options: [
        { label: "FSL", value: "fsl" },
        { label: "HubCloud 10Gbps", value: "hubcloud" },
        { label: "Direct R2", value: "r2" },
        { label: "ZipDisk", value: "zipdisk" },
        { label: "All Sources", value: "all" }
      ],
      default: "fsl"
    },
    {
      type: "select",
      key: "sort",
      name: "sort",
      label: "Sort By",
      options: [
        { label: "Quality first (4K → 1080p → 720p)", value: "quality" },
        { label: "Size first (largest file on top)", value: "size" }
      ],
      default: "quality"
    }
  ];
}
function resolveSettings(input) {
  const LABEL_MAP = {
    fsl: "FSL",
    hubcloud: "HubCloud 10Gbps",
    "hubcloud 10gbps": "HubCloud 10Gbps",
    r2: "Direct R2",
    "direct r2": "Direct R2",
    zipdisk: "ZipDisk Server",
    "zipdisk server": "ZipDisk Server",
    hblinks: "Hblinks Direct",
    "hblinks direct": "Hblinks Direct",
    all: null, any: null
  };
  let s = { sourceLabel: "FSL", sortBy: "quality" };
  try {
    let settings = input;
    if (!settings && typeof globalThis !== "undefined") settings = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS || globalThis.settings;
    if (!settings && typeof global !== "undefined") settings = global.SCRAPER_SETTINGS || global.SETTINGS || global.settings;
    if (!settings && typeof window !== "undefined") settings = window.SCRAPER_SETTINGS || window.SETTINGS || window.settings;
    if (settings) {
      let rawSrc = settings.source || settings.src || settings.preferred_source || "";
      if (typeof rawSrc === "object" && rawSrc !== null) rawSrc = rawSrc.value || rawSrc.key || "";
      const normSrc = String(rawSrc).toLowerCase().trim();
      if (normSrc && LABEL_MAP.hasOwnProperty(normSrc)) s.sourceLabel = LABEL_MAP[normSrc];

      let rawSort = settings.sort || settings.sortBy || settings.sort_by || "";
      if (typeof rawSort === "object" && rawSort !== null) rawSort = rawSort.value || rawSort.key || "";
      const normSort = String(rawSort).toLowerCase().trim();
      if (normSort === "size" || normSort === "largest") s.sortBy = "size";
      else s.sortBy = "quality";
    }
  } catch (e) { console.log(`[4KHDHub] settings parse error: ${e.message}`); }
  return s;
}

// ============================================================
// RELEASE INFO
// ============================================================
function parseReleaseInfo(releaseTitle) {
  const t = String(releaseTitle || "");
  const info = { source: "", codec: "", hdr: "", dv: false, audio: [] };
  if (/bluray|blu-ray|bdrip|brrip/i.test(t)) info.source = "BluRay";
  else if (/web-?dl|webrip/i.test(t)) info.source = "WEB-DL";
  else if (/hdtv/i.test(t)) info.source = "HDTV";
  if (/x265|h\.?265|hevc/i.test(t)) info.codec = "H.265";
  else if (/x264|h\.?264|avc/i.test(t)) info.codec = "H.264";
  if (/hdr10\+/i.test(t)) info.hdr = "HDR10+";
  else if (/hdr10/i.test(t)) info.hdr = "HDR10";
  else if (/\bhdr\b/i.test(t)) info.hdr = "HDR";
  if (/dolby.?vision|dovi|(?:^|[._\-\[ ])dv(?:[._\-\] ]|$)/i.test(t)) info.dv = true;

  let typeTag = "";
  if (/\bhindi\b/i.test(t) || /\bmulti[\s._-]?audio\b/i.test(t)) typeTag = "Multi";
  else if (/\bdual[\s._-]?audio\b/i.test(t)) typeTag = "Dual-Audio";

  const codecBits = [];
  if (/truehd[\s._-]*7\.1/i.test(t)) codecBits.push("TrueHD 7.1");
  else if (/ddp[\s._-]*5\.1|eac3/i.test(t)) codecBits.push("DDP5.1");
  else if (/dd[\s._-]*5\.1|(?:^|[._\- ])ac3(?:[._\- ]|$)/i.test(t)) codecBits.push("DD5.1");
  else if (/\baac\b/i.test(t)) codecBits.push("AAC");
  if (/\batmos\b/i.test(t)) codecBits.push("Atmos");

  if (typeTag) info.audio.push(typeTag);
  for (const c of codecBits) info.audio.push(c);
  return info;
}

var cheerio = require("cheerio-without-node-native");
function fetchPageUrl(name, year, isSeries) {
  return __async(this, null, function* () {
    const domain = yield fetchLatestDomain();
    const searchUrl = `${domain}/?s=${encodeURIComponent(name + " " + year)}`;
    console.log(`[4KHDHub] Search Request URL: ${searchUrl}`);
    const html = yield fetchText(searchUrl);
    if (!html) { console.log("[4KHDHub] Search failed: No HTML response"); return null; }
    const $ = cheerio.load(html);
    const targetType = isSeries ? "Series" : "Movies";
    const matchingCards = $(".movie-card").filter((_, el) => {
      return $(el).find(`.movie-card-format:contains("${targetType}")`).length > 0;
    }).filter((_, el) => {
      const metaText = $(el).find(".movie-card-meta").text();
      const movieCardYear = parseInt(metaText);
      return !isNaN(movieCardYear) && Math.abs(movieCardYear - year) <= 1;
    }).filter((_, el) => {
      const movieCardTitle = $(el).find(".movie-card-title").text().replace(/\[.*?]/g, "").trim();
      const distance = levenshteinDistance(movieCardTitle.toLowerCase(), name.toLowerCase());
      return distance < 5;
    }).map((_, el) => {
      let href = $(el).attr("href");
      if (href && !href.startsWith("http")) href = domain + (href.startsWith("/") ? "" : "/") + href;
      return href;
    }).get();
    return matchingCards.length > 0 ? matchingCards[0] : null;
  });
}
var cheerio2 = require("cheerio-without-node-native");
function resolveRedirectUrl(redirectUrl) {
  return __async(this, null, function* () {
    if (redirectUrl.includes("hubcloud.") || redirectUrl.includes("hubdrive.")) return redirectUrl;
    const redirectHtml = yield fetchText(redirectUrl);
    if (!redirectHtml) return redirectUrl;
    try {
      const redirectDataMatch = redirectHtml.match(/'o','(.*?)'/);
      if (!redirectDataMatch) return redirectUrl;
      const step1 = atob(redirectDataMatch[1]);
      const step2 = atob(step1);
      const step3 = rot13Cipher(step2);
      const step4 = atob(step3);
      const redirectData = JSON.parse(step4);
      if (redirectData && redirectData.o) return atob(redirectData.o);
    } catch (e) { console.log(`[4KHDHub] Error resolving redirect: ${e.message}`); }
    return redirectUrl;
  });
}
function extractSourceResults($, el) {
  return __async(this, null, function* () {
    const localHtml = $(el).html();
    const sizeMatch = localHtml.match(/([\d.]+ ?[GM]B)/);
    const heightMatch = localHtml.match(/\d{3,}p/);
    const title = $(el).find(".file-title, .episode-file-title").text().trim();
    let height = heightMatch ? parseInt(heightMatch[0]) : 0;
    if (height === 0 && (title.includes("4K") || title.includes("4k") || localHtml.includes("4K") || localHtml.includes("4k"))) height = 2160;
    const meta = { bytes: sizeMatch ? parseBytes(sizeMatch[1]) : 0, height, title };
    const hblinksLink = $(el).find("a").filter((_, a) => {
      const href = $(a).attr("href") || "";
      return href.includes("hblinks") || href.includes("hubstream.dad");
    }).attr("href");
    if (hblinksLink) return { url: new URL(hblinksLink, BASE_URL).toString(), meta, extractor: "hblinks" };
    const hubCloudLink = $(el).find("a").filter((_, a) => {
      const text = $(a).text();
      const href = $(a).attr("href") || "";
      return text.includes("HubCloud") || href.includes("hubcloud.") || href.includes("hubcloud/");
    }).attr("href");
    if (hubCloudLink) {
      const resolved = yield resolveRedirectUrl(hubCloudLink);
      return { url: resolved, meta };
    }
    const hubDriveLink = $(el).find("a").filter((_, a) => {
      const text = $(a).text();
      const href = $(a).attr("href") || "";
      return text.includes("HubDrive") || href.includes("hubdrive.") || href.includes("hubdrive/");
    }).attr("href");
    if (hubDriveLink) {
      const resolvedDrive = yield resolveRedirectUrl(hubDriveLink);
      if (resolvedDrive) {
        const hubDriveHtml = yield fetchText(resolvedDrive);
        if (hubDriveHtml) {
          const $2 = cheerio2.load(hubDriveHtml);
          const innerCloudLink = $2('a:contains("HubCloud")').attr("href") || $2("a").filter((_, a) => {
            const text = $2(a).text();
            const href = $2(a).attr("href") || "";
            return text.includes("HubCloud") || href.includes("hubcloud.") || href.includes("hubcloud/");
          }).attr("href");
          if (innerCloudLink) return { url: innerCloudLink, meta };
        }
      }
    }
    return null;
  });
}
function extractHubCloud(hubCloudUrl, baseMeta) {
  return __async(this, null, function* () {
    if (!hubCloudUrl) return [];
    const redirectHtml = yield fetchText(hubCloudUrl, { headers: { Referer: hubCloudUrl } });
    if (!redirectHtml) return [];
    const redirectUrlMatch = redirectHtml.match(/var url ?= ?'(.*?)'/);
    if (!redirectUrlMatch) return [];
    const finalLinksUrl = redirectUrlMatch[1];
    const linksHtml = yield fetchText(finalLinksUrl, { headers: { Referer: hubCloudUrl } });
    if (!linksHtml) return [];
    const $ = cheerio2.load(linksHtml);
    const results = [];
    const sizeText = $("#size").text();
    const titleText = $("title").text().trim();
    const currentMeta = __spreadProps(__spreadValues({}, baseMeta), {
      bytes: parseBytes(sizeText) || baseMeta.bytes,
      title: titleText || baseMeta.title
    });
    $("a").each((_, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr("href");
      if (!href) return;
      if (text.includes("10Gbps") || text.includes("PixelServer") || href.includes("hubcloud.cx")) results.push({ source: "HubCloud 10Gbps", url: href, meta: currentMeta });
      else if (text.includes("Download File") || href.includes("r2.dev")) results.push({ source: "Direct R2", url: href, meta: currentMeta });
      else if (text.includes("ZipDisk") || href.includes("workers.dev")) results.push({ source: "ZipDisk Server", url: href, meta: currentMeta });
      else if (text.includes("FSL")) results.push({ source: "FSL", url: href, meta: currentMeta });
    });
    return results;
  });
}
function extractHblinks(hblinksUrl, baseMeta, depth) {
  depth = depth || 0;
  return __async(this, null, function* () {
    if (!hblinksUrl || depth > 2) return [];
    try {
      const html = yield fetchText(hblinksUrl, { headers: { Referer: hblinksUrl } });
      if (!html) return [];
      const $ = cheerio2.load(html);
      const links = [...new Set($("h3 a, h5 a, div.entry-content p a, div.entry-content a").map((_, el) => $(el).attr("href")).get().filter(Boolean))];
      const results = [];
      for (const rawLink of links) {
        try {
          const absoluteLink = new URL(rawLink, hblinksUrl).toString();
          const resolvedLink = yield resolveRedirectUrl(absoluteLink);
          const link = resolvedLink || absoluteLink;
          const hostname = new URL(link).hostname.toLowerCase();
          if (hostname.includes("hblinks") || hostname.includes("hubstream.dad")) {
            results.push(...(yield extractHblinks(link, baseMeta, depth + 1)));
          } else if (hostname.includes("hubcloud")) {
            results.push(...(yield extractHubCloud(link, baseMeta)));
          } else if (hostname.includes("hubdrive")) {
            const driveHtml = yield fetchText(link, { headers: { Referer: hblinksUrl } });
            if (driveHtml) {
              const $drive = cheerio2.load(driveHtml);
              const cloudLink = $drive("a").filter((_, a) => {
                const text = $drive(a).text();
                const href = $drive(a).attr("href") || "";
                return text.includes("HubCloud") || href.includes("hubcloud.") || href.includes("hubcloud/");
              }).attr("href");
              if (cloudLink) results.push(...(yield extractHubCloud(new URL(cloudLink, link).toString(), baseMeta)));
            }
          } else if (/\.(m3u8|mpd|mp4|mkv)(?:$|\?)/i.test(link)) {
            results.push({ source: "Hblinks Direct", url: link, meta: baseMeta });
          }
        } catch (e) {}
      }
      return results;
    } catch (e) { return []; }
  });
}
var cheerio3 = require("cheerio-without-node-native");
function getStreams(tmdbId, type, season, episode, settings) {
  return __async(this, null, function* () {
    const resolved = resolveSettings(settings);
    console.log(`[4KHDHub] Preferred source: ${resolved.sourceLabel || "all"} | Sort: ${resolved.sortBy}`);

    const tmdbDetails = yield getTmdbDetails(tmdbId, type);
    if (!tmdbDetails) return [];
    const { title, year } = tmdbDetails;
    const isSeries = type === "series" || type === "tv";
    const pageUrl = yield fetchPageUrl(title, year, isSeries);
    if (!pageUrl) { console.log("[4KHDHub] Page not found"); return []; }
    const html = yield fetchText(pageUrl);
    if (!html) return [];
    const $ = cheerio3.load(html);
    const itemsToProcess = [];
    if (isSeries && season && episode) {
      const seasonStr = "S" + String(season).padStart(2, "0");
      const episodeStr = "Episode-" + String(episode).padStart(2, "0");
      $(".episode-item").each((_, el) => {
        if ($(".episode-title", el).text().includes(seasonStr)) {
          $(".episode-download-item", el).filter((_2, item) => $(item).text().includes(episodeStr)).each((_2, item) => { itemsToProcess.push(item); });
        }
      });
    } else {
      $(".download-item").each((_, el) => { itemsToProcess.push(el); });
    }
    console.log(`[4KHDHub] Processing ${itemsToProcess.length} items`);

    const seSuffix = isSeries && season && episode ? ` S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}` : "";
    const titleLine = `${title} (${year})${seSuffix}`;

    const streamPromises = itemsToProcess.map((item) => __async(this, null, function* () {
      try {
        const sourceResult = yield extractSourceResults($, item);
        if (!sourceResult || !sourceResult.url) return [];
        let extractedLinks;
        if (sourceResult.extractor === "hblinks") extractedLinks = yield extractHblinks(sourceResult.url, sourceResult.meta);
        else extractedLinks = yield extractHubCloud(sourceResult.url, sourceResult.meta);

        return extractedLinks.map((link) => {
          const height = sourceResult.meta.height || 0;
          const qualityShort = height === 2160 ? "4K" : height ? height + "p" : "";
          const qualityFull = height === 2160 ? "2160p" : height ? height + "p" : "";

          const info = parseReleaseInfo(link.meta.title);

          const tagParts = [];
          if (link.source) tagParts.push(link.source);
          if (info.source) tagParts.push(info.source);
          if (info.codec) tagParts.push(info.codec);
          if (info.hdr) tagParts.push(info.hdr);
          if (info.dv) tagParts.push("DV");
          const tagLine = tagParts.join(" • ");

          const sizeLine = formatBytes(link.meta.bytes || 0);
          const audioLine = info.audio.length ? "Audio: " + info.audio.join(", ") : "";

          const lines = [titleLine];
          if (tagLine) lines.push(tagLine);
          if (sizeLine && sizeLine !== "0 B") lines.push(sizeLine);
          if (audioLine) lines.push(audioLine);
          const description = lines.join("\n");

          // Base name — rank prefix gets added later, after global sort
          const baseName = qualityShort ? `4KHDHub ${qualityShort}` : "4KHDHub";

          return {
            name: baseName,
            title: description,
            size: description,
            description,
            url: link.url,
            __qr: height,
            __sb: link.meta.bytes || 0,
            behaviorHints: { bingeGroup: `4khdhub-${link.source}` }
          };
        });
      } catch (err) {
        console.log(`[4KHDHub] Item processing error: ${err.message}`);
        return [];
      }
    }));

    const results = yield Promise.all(streamPromises);
    const flat = results.reduce((acc, val) => acc.concat(val), []);

    // ---- Source filter ----
    const visible = resolved.sourceLabel
      ? flat.filter(r => r.behaviorHints && r.behaviorHints.bingeGroup === `4khdhub-${resolved.sourceLabel}`)
      : flat;
    console.log(`[4KHDHub] Filter (${resolved.sourceLabel || "all"}): ${visible.length}/${flat.length}`);

    // ---- Dedupe ----
    const seen = new Set();
    const deduped = [];
    for (const r of visible) {
      const key = (r.description || "").replace(/\n/g, "|");
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }
    console.log(`[4KHDHub] After dedupe: ${deduped.length}/${visible.length} kept`);

    // ---- Sort by chosen mode ----
    if (resolved.sortBy === "size") {
      deduped.sort((a, b) => b.__sb - a.__sb);
    } else {
      deduped.sort((a, b) => {
        if (b.__qr !== a.__qr) return b.__qr - a.__qr;
        return b.__sb - a.__sb;
      });
    }

   // ---- Assign invisible sort prefix using Unicode Variation Selectors ----
    // VS1..VS16 (U+FE00-U+FE0F) + VS17..VS256 (U+E0100-U+E01EF) = 256 levels
    // Invisible, zero-width, and their codepoints ascend with rank.
    for (let i = 0; i < deduped.length; i++) {
      const r = deduped[i];
      let prefix = "";
      if (i < 16) prefix = String.fromCodePoint(0xFE00 + i);
      else if (i < 256) prefix = String.fromCodePoint(0xE0100 + (i - 16));
      r.name = prefix + r.name;
      delete r.__qr;
      delete r.__sb;
    }
    return deduped;
  });
}
module.exports = { getStreams, onSettings };
