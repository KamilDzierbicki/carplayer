import { withCorsProxy } from "./cors-proxy.js";

/**
 * YouTube without a backend: the browser calls YouTube's own InnerTube API through a CORS proxy.
 *
 * - search: POST youtubei/v1/search as the WEB client, results read from "videoRenderer" items.
 * - stream: POST youtubei/v1/player as the ANDROID client, which still returns a direct googlevideo URL
 *   for format 18 (360p MP4 with audio and video in one file). The URL is bound to the IP that asked for it,
 *   so the video bytes must go through the same proxy.
 *
 * The proxy must forward POST bodies and Range headers and answer with CORS headers.
 * Normalized contract (kept from the earlier RapidAPI client):
 *   searchVideos(query) -> { videos: [{ id, title, durationText, thumbnailUrl, channelName, viewCountText }] }
 *   getStreamUrl(videoId) -> proxied URL of one MP4 file with audio and video
 */
const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1";
const WEB_CLIENT = { clientName: "WEB", clientVersion: "2.20251101.01.00" };
const ANDROID_CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, osName: "Android", osVersion: "11" };
// "Videos only" search filter, so channels and playlists do not fill the results.
const VIDEOS_ONLY_PARAMS = "EgIQAQ%3D%3D";
const MUXED_360P_ITAG = 18;
const VIDEO_ID_PATTERN = /^[\w-]{11}$/;

export default class YouTubeProxyClient {
  #proxyUrl;
  #language;
  #region;

  constructor({ proxyUrl }) {
    this.#proxyUrl = String(proxyUrl || "").trim();
    const [language = "en", region = "US"] = String(navigator.language || "en-US").split("-");
    this.#language = language.toLowerCase();
    this.#region = region.toUpperCase();
  }

  get isConfigured() {
    return Boolean(this.#proxyUrl);
  }

  async searchVideos(query) {
    const data = await this.#post("search", {
      context: this.#context(WEB_CLIENT),
      query,
      params: decodeURIComponent(VIDEOS_ONLY_PARAMS),
    });
    const videos = [...findRenderers(data, "videoRenderer")].map((item) => this.#normalize(item)).filter(Boolean);
    return { videos };
  }

  async getStreamUrl(videoId) {
    if (!VIDEO_ID_PATTERN.test(String(videoId || ""))) throw new Error("Invalid YouTube video id.");

    const data = await this.#post("player", {
      context: this.#context(ANDROID_CLIENT),
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    });

    const status = data?.playabilityStatus;
    if (status?.status !== "OK") {
      throw new Error(status?.reason || `Video is not playable (${status?.status || "unknown"}).`);
    }

    const formats = (data?.streamingData?.formats || []).filter((format) => format.url);
    const format = formats.find((entry) => entry.itag === MUXED_360P_ITAG) || formats[0];
    if (!format) throw new Error("YouTube returned no file with both audio and video for this video.");

    return {
      url: withCorsProxy(format.url, this.#proxyUrl),
      title: String(data?.videoDetails?.title || ""),
    };
  }

  #context(client) {
    return { client: { ...client, hl: this.#language, gl: this.#region } };
  }

  async #post(endpoint, body) {
    const target = `${INNERTUBE_URL}/${endpoint}?prettyPrint=false`;
    const response = await fetch(withCorsProxy(target, this.#proxyUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`YouTube ${endpoint} failed (HTTP ${response.status}).`);
    return response.json();
  }

  #normalize(item) {
    const id = item?.videoId;
    if (!VIDEO_ID_PATTERN.test(String(id || ""))) return null;
    return {
      id,
      title: readText(item.title),
      durationText: readText(item.lengthText),
      // Thumbnails are plain <img> backgrounds, so YouTube's own CDN works without the proxy.
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      channelName: readText(item.ownerText || item.longBylineText),
      viewCountText: readText(item.shortViewCountText || item.viewCountText),
    };
  }
}

function readText(value) {
  if (!value) return "";
  if (typeof value.simpleText === "string") return value.simpleText;
  return (value.runs || []).map((run) => run.text).join("");
}

function* findRenderers(node, key) {
  if (Array.isArray(node)) {
    for (const child of node) yield* findRenderers(child, key);
  } else if (node && typeof node === "object") {
    if (node[key]) yield node[key];
    for (const child of Object.values(node)) yield* findRenderers(child, key);
  }
}
