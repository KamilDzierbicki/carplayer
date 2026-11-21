import YouTubeProxyClient from "./youtube-proxy-client.js";

/** YouTube tab: proxy configuration (manual or from phone), search and playback through the canvas player. */
export default class YouTubeController {
  #app;
  #storage;
  #share;
  #player;
  #view;
  #client;

  constructor({ app, storage, share, player }) {
    this.#app = app;
    this.#storage = storage;
    this.#share = share;
    this.#player = player;
    this.#view = document.getElementById("youtubeComponent");
    this.#client = new YouTubeProxyClient(this.#storage.getYoutubeConfig());

    this.#share.registerMobileMode("ytshare", "mobileYoutubeModal");
    this.#share.registerPayloadHandler("youtube-config", (value) => this.#applyConfig(value, { fromPhone: true }));
    this.#bindEvents();
  }

  init() {
    this.#view?.setConfig(this.#storage.getYoutubeConfig());
    this.#view?.showResults({});
  }

  /** Plays a video by id, also from history entries saved as https://www.youtube.com/watch?v=ID. */
  play(videoId, title = "") {
    return this.#play(videoId, title);
  }

  #bindEvents() {
    if (!this.#view) return;

    this.#view.addEventListener("save-config", (event) => this.#applyConfig(event.detail));
    this.#view.addEventListener("search", (event) => void this.#search(event.detail.query));
    this.#view.addEventListener("play-youtube", (event) => this.#play(event.detail.id, event.detail.title));
    this.#view.addEventListener("view-change", () => this.#syncRelayQr());
    document.addEventListener("tab-change", () => this.#syncRelayQr());

    document.getElementById("btnSendYoutubeConfig")?.addEventListener("click", async () => {
      const input = document.getElementById("mobileYoutubeProxyInput");
      const proxyUrl = String(input?.value || "").trim();
      if (!proxyUrl) {
        alert("Paste the proxy address first.");
        return;
      }
      if (await this.#share.sendPayloadToCar({ type: "youtube-config", value: { proxyUrl } })) {
        this.#app.closeModal("mobileYoutubeModal");
        alert("Proxy sent to the car.");
      }
    });
  }

  #syncRelayQr() {
    const active = document.getElementById("appDock")?.getAttribute("active") === "youtube";
    if (active && this.#view?.isSetupVisible && !this.#share.isPhoneRelayMode()) {
      void this.#share.showRelayQr(this.#view.qrContainer, "ytshare", 200);
    }
  }

  #applyConfig(rawConfig, options = {}) {
    const config = { proxyUrl: String(rawConfig?.proxyUrl || "").trim() };
    if (!/^https?:\/\//i.test(config.proxyUrl)) {
      alert("Enter a proxy address that starts with http:// or https://");
      return;
    }

    this.#storage.saveYoutubeConfig(config);
    this.#client = new YouTubeProxyClient(config);
    this.#view?.setConfig(config);
    if (options.fromPhone) {
      document.dispatchEvent(new CustomEvent("request-tab", { detail: { tab: "youtube" } }));
    }
  }

  async #search(query) {
    const pastedId = query.match(this.#app.youtubeRegex)?.[1];
    if (pastedId) {
      this.#play(pastedId, "");
      return;
    }

    this.#view.showResults({ loading: true });
    try {
      const { videos } = await this.#client.searchVideos(query);
      this.#view.showResults({ videos, empty: "No results found." });
    } catch (error) {
      console.error("[YouTube] search failed", error);
      this.#view.showResults({ error: `Search failed: ${error.message}. Check that the CORS proxy is reachable and forwards POST requests.` });
    }
  }

  async #play(videoId, title) {
    if (!this.#client.isConfigured) {
      alert("Set a CORS proxy in the YouTube tab first.");
      document.dispatchEvent(new CustomEvent("request-tab", { detail: { tab: "youtube" } }));
      return;
    }

    let stream;
    try {
      stream = await this.#client.getStreamUrl(videoId);
    } catch (error) {
      console.error("[YouTube] stream lookup failed", error);
      alert(`Cannot play this video: ${error.message}`);
      return;
    }

    // Same canvas player as every other source; the stream link expires, so history keeps the watch URL.
    await this.#player.loadVideo(stream.url, {
      title: title || stream.title || `YouTube ${videoId}`,
      sourceType: "youtube",
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      historyId: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }
}
