import { channelMatchKey, parseM3u, parseXmltvStream } from "./iptv-parsers.js";
import { withCorsProxy } from "./cors-proxy.js";

// Public Polish channels from iptv-org (sends CORS headers). The EPG sample has no CORS,
// so it loads only with a CORS proxy configured; the channel list works without it.
const SAMPLE_CONFIG = Object.freeze({
  playlistUrl: "https://iptv-org.github.io/iptv/countries/pl.m3u",
  epgUrl: "https://epgshare01.online/epgshare01/epg_ripper_PL1.xml.gz",
});

const GUIDE_WINDOW_BEFORE_MS = 3 * 3600 * 1000;
const GUIDE_WINDOW_AFTER_MS = 24 * 3600 * 1000;

/** IPTV tab: playlist + EPG configuration (manual, sample or from phone), channel list and live playback. */
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
    this.#view?.setConfig(this.#storage.getIptvConfig());
  }

  #bindEvents() {
    if (!this.#view) return;

    this.#view.addEventListener("save-config", (event) => this.#applyConfig(event.detail));
    this.#view.addEventListener("load-sample", () => this.#applyConfig({ ...SAMPLE_CONFIG, corsProxy: this.#readCorsProxyField() }));
    this.#view.addEventListener("reload", () => void this.#load({ force: true }));
    this.#view.addEventListener("play-channel", (event) => this.#play(event.detail.channelId));
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

  #readCorsProxyField() {
    return String(this.#view?.querySelector('[data-field="corsProxy"]')?.value || "").trim();
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

    this.#view.setStatus("Loading channels...");
    let playlist;
    try {
      const response = await fetch(withCorsProxy(config.playlistUrl, config.corsProxy));
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
    this.#view.setChannels(this.#channels);
    this.#view.setGuide(new Map());

    const epgUrl = config.epgUrl || playlist.epgUrl;
    if (!epgUrl) {
      this.#view.setStatus(`${this.#channels.length} channels. No program guide configured.`);
      return;
    }

    this.#view.setStatus(`${this.#channels.length} channels. Loading program guide...`);
    try {
      const guide = await this.#loadGuide(withCorsProxy(epgUrl, config.corsProxy));
      if (token !== this.#loadToken) return;
      this.#view.setGuide(guide);
      this.#view.setStatus(`${this.#channels.length} channels. Program guide for ${guide.size} of them.`);
    } catch (error) {
      if (token !== this.#loadToken) return;
      console.warn("[IPTV] EPG failed", error);
      this.#view.setStatus(`${this.#channels.length} channels. Program guide failed (${error.message}). If its server has no CORS, set a CORS proxy.`, true);
    }
  }

  async #loadGuide(url) {
    const response = await fetch(url);
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

  #play(channelId) {
    const channel = this.#channels.find((entry) => entry.id === channelId);
    if (!channel) return;

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
