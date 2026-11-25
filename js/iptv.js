import { channelFavoriteKey, channelMatchKey, parseM3u, parseXmltvStream } from "./iptv-parsers.js";
import { withCorsProxy } from "./cors-proxy.js";

const GUIDE_WINDOW_BEFORE_MS = 3 * 3600 * 1000;
const GUIDE_WINDOW_AFTER_MS = 24 * 3600 * 1000;

/** IPTV tab: playlist + EPG configuration (manual or from phone), channel list and live playback. */
export default class IptvController {
  #app;
  #storage;
  #share;
  #player;
  #view;
  #channels = [];
  #loadToken = 0;
  #loadedConfigKey = "";

  constructor({ app, storage, share, player }) {
    this.#app = app;
    this.#storage = storage;
    this.#share = share;
    this.#player = player;
    this.#view = document.getElementById("iptvComponent");

    this.#share.registerMobileMode("iptvshare", "mobileIptvModal");
    this.#share.registerPayloadHandler("iptv-config", (value) => this.#applyConfig(value, { fromPhone: true }));
    this.#bindEvents();
  }

  init() {
    this.#view?.setFavorites(this.#favoriteKeys());
    this.#view?.setConfig(this.#storage.getIptvConfig());
  }

  /** Plays a favorite channel from its saved stream link, used by the dashboard Favorites widget. */
  playFavorite(key) {
    const favorite = this.#storage.getIptvFavorites().find((entry) => entry.key === key);
    if (!favorite?.url) {
      alert("Open the IPTV tab once, so CarPlayer can find this channel's stream link.");
      return;
    }
    this.#playChannel(favorite);
  }

  #bindEvents() {
    if (!this.#view) return;

    this.#view.addEventListener("save-config", (event) => this.#applyConfig(event.detail));
    this.#view.addEventListener("reload", () => void this.#load({ force: true }));
    this.#view.addEventListener("play-channel", (event) => {
      const channel = this.#channels.find((entry) => entry.id === event.detail.channelId);
      if (channel) this.#playChannel(channel);
    });
    this.#view.addEventListener("toggle-favorite", (event) => this.#toggleFavorite(event.detail));
    this.#view.addEventListener("view-change", () => this.#syncRelayQr());
    document.addEventListener("tab-change", (event) => {
      this.#syncRelayQr();
      if (event.detail.tab === "iptv") void this.#load();
    });

    document.getElementById("btnSendIptvConfig")?.addEventListener("click", async () => {
      const playlistUrl = String(document.getElementById("mobileIptvPlaylistInput")?.value || "").trim();
      const epgUrl = String(document.getElementById("mobileIptvEpgInput")?.value || "").trim();
      if (!playlistUrl) {
        alert("Paste the playlist link first.");
        return;
      }
      if (await this.#share.sendPayloadToCar({ type: "iptv-config", value: { playlistUrl, epgUrl } })) {
        this.#app.closeModal("mobileIptvModal");
        alert("IPTV links sent to the car.");
      }
    });
  }

  #syncRelayQr() {
    const active = document.getElementById("appDock")?.getAttribute("active") === "iptv";
    if (active && this.#view?.isSetupVisible && !this.#share.isPhoneRelayMode()) {
      void this.#share.showRelayQr(this.#view.qrContainer, "iptvshare", 200);
    }
  }

  #applyConfig(rawConfig, options = {}) {
    const current = this.#storage.getIptvConfig();
    const config = {
      playlistUrl: String(rawConfig?.playlistUrl || "").trim(),
      epgUrl: String(rawConfig?.epgUrl || "").trim(),
      corsProxy: String(rawConfig?.corsProxy ?? current.corsProxy ?? "").trim(),
    };
    if (!/^https?:\/\//i.test(config.playlistUrl)) {
      alert("Enter a playlist link that starts with http:// or https://");
      return;
    }

    this.#storage.saveIptvConfig(config);
    this.#view?.setConfig(config);
    if (options.fromPhone) {
      document.dispatchEvent(new CustomEvent("request-tab", { detail: { tab: "iptv" } }));
    }
    void this.#load({ force: true });
  }

  async #load({ force = false } = {}) {
    const config = this.#storage.getIptvConfig();
    if (!config.playlistUrl || !this.#view) return;

    const configKey = JSON.stringify(config);
    if (!force && configKey === this.#loadedConfigKey) return;
    this.#loadedConfigKey = configKey;
    const token = ++this.#loadToken;

    this.#view.setLoading(true);
    this.#view.setStatus("Loading channels...");
    // A configured guide downloads while the playlist loads; only matching it to channels waits for the playlist.
    const earlyGuideResponse = config.epgUrl ? this.#fetchAllowingProxy(config.epgUrl, config.corsProxy) : null;
    earlyGuideResponse?.catch(() => {});
    let playlist;
    try {
      const response = await this.#fetchAllowingProxy(config.playlistUrl, config.corsProxy);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      playlist = parseM3u(await response.text());
    } catch (error) {
      if (token !== this.#loadToken) return;
      this.#loadedConfigKey = "";
      this.#view.setChannels([]);
      this.#view.setStatus(`Could not load the playlist (${error.message}). Check the link, or set a CORS proxy in IPTV settings.`, true);
      return;
    }
    if (token !== this.#loadToken) return;

    this.#channels = playlist.channels;
    this.#refreshFavorites();
    this.#view.setChannels(this.#channels);
    this.#view.setGuide(new Map());

    const epgUrl = config.epgUrl || playlist.epgUrl;
    if (!epgUrl) {
      this.#view.setStatus("");
      return;
    }

    this.#view.setGuide(new Map(), { loading: true });
    this.#view.setStatus("");
    try {
      const guide = await this.#loadGuide(epgUrl, config.corsProxy, epgUrl === config.epgUrl ? earlyGuideResponse : null);
      if (token !== this.#loadToken) return;
      this.#view.setGuide(guide);
      this.#view.setStatus("");
    } catch (error) {
      if (token !== this.#loadToken) return;
      console.warn("[IPTV] EPG failed", error);
      this.#view.setGuide(new Map());
      this.#view.setStatus(`Program guide failed (${error.message}). Its server may block browsers: set a CORS proxy in IPTV settings or in the Tube tab.`, true);
    }
  }

  /**
   * Fetches directly, or through the IPTV CORS proxy when one is set. A server without CORS headers fails as a
   * network error, so a direct fetch is retried once through the proxy saved in the Tube tab.
   */
  async #fetchAllowingProxy(url, corsProxy) {
    if (corsProxy) return fetch(withCorsProxy(url, corsProxy));
    try {
      return await fetch(url);
    } catch (error) {
      const fallbackProxy = this.#storage.getTubeConfig().proxyUrl;
      if (!fallbackProxy) throw error;
      return fetch(withCorsProxy(url, fallbackProxy));
    }
  }

  async #loadGuide(url, corsProxy, earlyResponse = null) {
    const response = await (earlyResponse || this.#fetchAllowingProxy(url, corsProxy));
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

    // Detect gzip by magic bytes: servers often send .xml.gz as application/octet-stream.
    const [head, body] = response.body.tee();
    const headReader = head.getReader();
    const firstChunk = (await headReader.read()).value || new Uint8Array();
    // Cancel the probe branch, otherwise tee() buffers the whole file for it.
    void headReader.cancel();
    const isGzip = firstChunk[0] === 0x1f && firstChunk[1] === 0x8b;
    const bytes = isGzip ? body.pipeThrough(new DecompressionStream("gzip")) : body;
    const text = bytes.pipeThrough(new TextDecoderStream());

    const keyToChannel = new Map();
    this.#channels.forEach((channel) => {
      [channel.tvgId, channel.tvgName, channel.name].forEach((value) => {
        const key = channelMatchKey(value);
        if (key && !keyToChannel.has(key)) keyToChannel.set(key, channel.id);
      });
    });

    const claimed = new Set();
    const now = Date.now();
    return parseXmltvStream(text, ({ id, names }) => {
      for (const value of [id, ...names]) {
        const channelId = keyToChannel.get(channelMatchKey(value));
        // First EPG channel wins, so duplicate EPG feeds do not double the schedule.
        if (channelId && !claimed.has(channelId)) {
          claimed.add(channelId);
          return channelId;
        }
      }
      return null;
    }, { from: now - GUIDE_WINDOW_BEFORE_MS, to: now + GUIDE_WINDOW_AFTER_MS });
  }

  #favoriteKeys() {
    return this.#storage.getIptvFavorites().map((entry) => entry.key);
  }

  #toggleFavorite({ key, channelId }) {
    const favorites = this.#storage.getIptvFavorites();
    const channel = this.#channels.find((entry) => entry.id === channelId);
    const next = favorites.some((entry) => entry.key === key)
      ? favorites.filter((entry) => entry.key !== key)
      : [...favorites, channel ? favoriteSnapshot(channel) : { key, name: key, url: "", logo: "" }];
    this.#storage.saveIptvFavorites(next);
    this.#view.setFavorites(next.map((entry) => entry.key));
  }

  /** Stream links and logos can change between playlist versions, so saved favorites follow the loaded playlist. */
  #refreshFavorites() {
    const favorites = this.#storage.getIptvFavorites();
    if (!favorites.length) return;
    const byKey = new Map(this.#channels.map((channel) => [channelFavoriteKey(channel), channel]));
    const refreshed = favorites.map((entry) => (byKey.has(entry.key) ? favoriteSnapshot(byKey.get(entry.key)) : entry));
    if (JSON.stringify(refreshed) !== JSON.stringify(favorites)) this.#storage.saveIptvFavorites(refreshed);
  }

  #playChannel(channel) {
    if (window.location.protocol === "https:" && channel.url.startsWith("http:")) {
      alert("This channel uses plain HTTP. The browser blocks HTTP streams on an HTTPS page, so it cannot play here.");
      return;
    }

    void this.#player.loadVideo(channel.url, {
      title: channel.name,
      sourceType: "iptv",
      thumbnailUrl: channel.logo,
    });
  }
}

function favoriteSnapshot(channel) {
  return { key: channelFavoriteKey(channel), name: channel.name, url: channel.url, logo: channel.logo || "" };
}
