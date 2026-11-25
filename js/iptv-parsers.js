/**
 * Pure parsers for IPTV data: M3U playlists and XMLTV program guides (EPG).
 */

/**
 * @typedef {{id: string, name: string, url: string, logo: string, group: string, tvgId: string, tvgName: string}} IptvChannel
 * @typedef {{start: number, stop: number, title: string, desc: string}} EpgProgramme
 */

const ATTRIBUTE_PATTERN = /([\w-]+)="([^"]*)"/g;

/** @returns {{channels: IptvChannel[], epgUrl: string}} */
export function parseM3u(text) {
  const lines = String(text || "").split(/\r?\n/);
  const channels = [];
  let epgUrl = "";
  let pending = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTM3U")) {
      const attrs = readAttributes(line);
      epgUrl = (attrs["x-tvg-url"] || attrs["url-tvg"] || "").split(",")[0].trim();
      continue;
    }

    if (line.startsWith("#EXTINF")) {
      const attrs = readAttributes(line);
      const commaIndex = findTitleComma(line);
      const name = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "";
      pending = {
        name: name || attrs["tvg-name"] || "Channel",
        logo: attrs["tvg-logo"] || "",
        group: (attrs["group-title"] || "").split(";")[0].trim(),
        tvgId: attrs["tvg-id"] || "",
        tvgName: attrs["tvg-name"] || "",
      };
      continue;
    }

    if (line.startsWith("#")) continue;

    if (pending) {
      channels.push({ id: `ch-${channels.length}`, url: line, ...pending });
      pending = null;
    }
  }

  return { channels, epgUrl };
}

/** Stable id of a channel across playlist reloads: channel ids are list positions, so tvg-id or the name is used. */
export function channelFavoriteKey(channel) {
  return channel.tvgId || channel.name;
}

/** Normalized key used to match playlist channels with EPG channels from another source. */
export function channelMatchKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/\b(hd|sd|fhd|uhd|4k|hevc)\b/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Streams an XMLTV document and keeps only programmes of the wanted channels inside the time window.
 * EPG files are often 50-200 MB uncompressed, so the text is scanned chunk by chunk instead of DOMParser.
 *
 * @param {ReadableStream<string>} textStream
 * @param {(xmlChannel: {id: string, names: string[]}) => string|null} resolveChannel maps an XMLTV channel to a playlist channel id
 * @param {{from: number, to: number}} window epoch ms
 * @returns {Promise<Map<string, EpgProgramme[]>>} playlist channel id -> programmes sorted by start
 */
export async function parseXmltvStream(textStream, resolveChannel, window) {
  const guide = new Map();
  const xmlToPlaylist = new Map();
  const reader = textStream.getReader();
  let buffer = "";

  const consume = (final) => {
    let cursor = 0;
    // The next "<channel" is searched again only once the cursor passes it. Channels come first in XMLTV, so after
    // them a fresh search per programme would rescan the whole buffer every time (quadratic, seconds per chunk).
    let channelStart = buffer.indexOf("<channel", cursor);
    while (true) {
      if (channelStart >= 0 && channelStart < cursor) channelStart = buffer.indexOf("<channel", cursor);
      const programmeStart = buffer.indexOf("<programme", cursor);
      const starts = [channelStart, programmeStart].filter((index) => index >= 0);
      if (!starts.length) break;

      const start = Math.min(...starts);
      const isChannel = start === channelStart;
      const closeTag = isChannel ? "</channel>" : "</programme>";
      const end = buffer.indexOf(closeTag, start);
      if (end < 0) {
        cursor = start;
        break;
      }

      const block = buffer.slice(start, end + closeTag.length);
      cursor = end + closeTag.length;

      if (isChannel) {
        const id = decodeXml(block.match(/\bid="([^"]*)"/)?.[1] || "");
        const names = [...block.matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g)].map((m) => decodeXml(m[1]));
        const playlistId = resolveChannel({ id, names });
        if (playlistId) xmlToPlaylist.set(id, playlistId);
        continue;
      }

      const channelId = decodeXml(block.match(/\bchannel="([^"]*)"/)?.[1] || "");
      const playlistId = xmlToPlaylist.get(channelId);
      if (!playlistId) continue;

      const startMs = parseXmltvTime(block.match(/\bstart="([^"]*)"/)?.[1]);
      const stopMs = parseXmltvTime(block.match(/\bstop="([^"]*)"/)?.[1]);
      if (!startMs || !stopMs || stopMs < window.from || startMs > window.to) continue;

      const list = guide.get(playlistId) || [];
      list.push({
        start: startMs,
        stop: stopMs,
        title: decodeXml(block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || ""),
        desc: decodeXml(block.match(/<desc[^>]*>([\s\S]*?)<\/desc>/)?.[1] || ""),
      });
      guide.set(playlistId, list);
    }

    buffer = final ? "" : buffer.slice(cursor);
  };

  // Give the page a frame now and then, so a large guide does not freeze the UI while it is parsed.
  let lastYield = performance.now();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    consume(false);
    if (performance.now() - lastYield > 50) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastYield = performance.now();
    }
  }
  consume(true);

  guide.forEach((list) => list.sort((a, b) => a.start - b.start));
  return guide;
}

/** "20261120180000 +0100" -> epoch ms */
export function parseXmltvTime(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/);
  if (!match) return 0;
  const [, y, mo, d, h, mi, s = "00", tz = "+0000"] = match;
  const offsetMinutes = (tz[0] === "-" ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - offsetMinutes * 60000;
}

function readAttributes(line) {
  const attrs = {};
  for (const match of line.matchAll(ATTRIBUTE_PATTERN)) attrs[match[1].toLowerCase()] = match[2];
  return attrs;
}

// The title follows the first comma outside quoted attribute values.
function findTitleComma(line) {
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') inQuotes = !inQuotes;
    else if (line[i] === "," && !inQuotes) return i;
  }
  return -1;
}

function decodeXml(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => safeCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => safeCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .trim();
}

function safeCodePoint(code) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}
