const ROWS = Object.freeze([
  { id: "continue", title: "Continue watching", load: (jf, userId) => jf.getResumeItems(userId) },
  { id: "movies", title: "Last added movies", load: (jf, userId) => jf.getLatestItems(userId, "Movie") },
  { id: "episodes", title: "Last added episodes", load: (jf, userId) => jf.getLatestItems(userId, "Episode") },
]);

/**
 * Jellyfin tab: server setup (manual or from phone), search and library rows.
 */
export default class JellyfinTabController {
  #storage;
  #share;
  #jellyfin;
  #view;
  #rowsLoadedFor = "";

  constructor({ storage, share, jellyfinService }) {
    this.#storage = storage;
    this.#share = share;
    this.#jellyfin = jellyfinService;
    this.#view = document.getElementById("jellyfinComponent");
    this.#bindEvents();
  }

  init() {
    this.#view?.setConfig({
      ...this.#storage.getJellyfinConfig(),
      videoCodec: this.#storage.getJellyfinVideoCodec() || "h264",
      videoBuffer: this.#storage.getVideoBuffer(),
    });
  }

  search(query) {
    const config = this.#storage.getJellyfinConfig();
    document.dispatchEvent(new CustomEvent("request-tab", { detail: { tab: "jellyfin" } }));
    if (!config.serverUrl || !config.apiKey) return;
    this.#view?.showSearch(config.serverUrl, config.apiKey, query);
  }

  #bindEvents() {
    if (!this.#view) return;

    this.#view.addEventListener("save-config", (event) => this.#saveConfig(event.detail));
    // The native "search" event of <input type="search"> bubbles here too and carries no detail.
    this.#view.addEventListener("search", (event) => {
      if (event.detail?.query) this.search(event.detail.query);
    });
    this.#view.addEventListener("play-jellyfin", (event) => {
      const { itemId, title, serverBaseUrl } = event.detail;
      void this.#jellyfin.load(itemId, title, serverBaseUrl);
    });
    this.#view.addEventListener("view-change", () => this.#syncRelayQr());
    document.addEventListener("tab-change", (event) => {
      this.#syncRelayQr();
      if (event.detail.tab === "jellyfin") void this.#loadRows();
    });
    // Settings modal and the phone relay can change the server too.
    document.addEventListener("jellyfin-config-changed", () => {
      this.#rowsLoadedFor = "";
      this.init();
      if (document.getElementById("appDock")?.getAttribute("active") === "jellyfin") void this.#loadRows();
    });
  }

  #syncRelayQr() {
    const active = document.getElementById("appDock")?.getAttribute("active") === "jellyfin";
    if (active && this.#view?.isSetupVisible && !this.#share.isPhoneRelayMode()) {
      // The existing "settings" phone flow sends server URL and API key as a jellyfin-config payload.
      void this.#share.showRelayQr(this.#view.qrContainer, "settings", 200);
    }
  }

  #saveConfig({ serverUrl, apiKey, videoCodec, videoBuffer }) {
    if (!/^https?:\/\//i.test(String(serverUrl || "")) || !apiKey) {
      alert("Enter the server address (starting with http:// or https://) and the API key.");
      return;
    }
    this.#storage.saveJellyfinConfig({
      serverUrl,
      apiKey,
      userId: "",
      videoCodec: videoCodec || "h264",
    });
    this.#storage.saveJellyfinVideoCodec(videoCodec || "h264");
    const buffer = parseFloat(videoBuffer);
    if (buffer > 0) this.#storage.saveVideoBuffer(buffer);
    document.dispatchEvent(new CustomEvent("jellyfin-config-changed"));
  }

  async #loadRows() {
    const config = this.#storage.getJellyfinConfig();
    if (!config.serverUrl || !config.apiKey || !this.#view) return;
    const key = `${config.serverUrl}|${config.apiKey}`;
    if (this.#rowsLoadedFor === key) return;
    this.#rowsLoadedFor = key;

    this.#view.setRows(ROWS.map((row) => ({ ...row, loading: true })));
    try {
      const library = await this.#jellyfin.getLibraryClient();
      const rows = await Promise.all(ROWS.map(async (row) => {
        try {
          return { ...row, items: await row.load(library.jf, library.userId), serverBaseUrl: library.jf.baseUrl };
        } catch (error) {
          return { ...row, error: `Could not load (${error.message}).` };
        }
      }));
      this.#view.setRows(rows);
    } catch (error) {
      this.#rowsLoadedFor = "";
      this.#view.setRows([{ id: "error", title: "Library", error: `Jellyfin is unavailable (${error.message}).` }]);
    }
  }
}
