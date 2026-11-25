export default class StorageService {
  #app;
  #historyRenderer = null;

  constructor(app) {
    this.#app = app;
  }

  setHistoryRenderer(historyRenderer) {
    this.#historyRenderer = historyRenderer;
  }

  saveJellyfinServerUrl(serverUrl) {
    localStorage.setItem("carplayer_jf_server_url", String(serverUrl || "").trim());
  }

  getJellyfinServerUrl() {
    return localStorage.getItem("carplayer_jf_server_url") || "";
  }

  saveJellyfinApiKey(apiKey) {
    localStorage.setItem("carplayer_jf_api_key", String(apiKey || "").trim());
  }

  getJellyfinApiKey() {
    return (
      localStorage.getItem("carplayer_jf_api_key")
      || localStorage.getItem("carplayer_yt_api_key")
      || ""
    );
  }

  saveJellyfinUserId(userId) {
    localStorage.setItem("carplayer_jf_user_id", String(userId || "").trim());
  }

  getJellyfinUserId() {
    return localStorage.getItem("carplayer_jf_user_id") || "";
  }

  clearJellyfinUserId() {
    localStorage.removeItem("carplayer_jf_user_id");
  }

  saveJellyfinVideoCodec(codec) {
    if (!codec) {
      localStorage.removeItem("carplayer_jellyfin_codec");
      return;
    }
    localStorage.setItem("carplayer_jellyfin_codec", codec);
  }

  getJellyfinVideoCodec() {
    return localStorage.getItem("carplayer_jellyfin_codec") || "h264";
  }

  saveJellyfinConfig({
    serverUrl = "",
    apiKey = "",
    userId = "",
    videoCodec = "",
  } = {}) {
    this.saveJellyfinServerUrl(serverUrl);
    this.saveJellyfinApiKey(apiKey);
    if (userId) {
      this.saveJellyfinUserId(userId);
    } else {
      this.clearJellyfinUserId();
    }

    if (videoCodec) {
      this.saveJellyfinVideoCodec(videoCodec);
    }
  }

  getJellyfinConfig() {
    return {
      serverUrl: this.getJellyfinServerUrl(),
      apiKey: this.getJellyfinApiKey(),
      userId: this.getJellyfinUserId(),
      videoCodec: this.getJellyfinVideoCodec(),
    };
  }

  // Legacy aliases to avoid breaking old callsites.
  saveApiKey(key) {
    this.saveJellyfinApiKey(key);
  }

  getApiKey() {
    return this.getJellyfinApiKey();
  }

  saveVolume(volume) {
    localStorage.setItem("carplayer_vol", volume);
  }

  getVolume() {
    const value = parseFloat(localStorage.getItem("carplayer_vol"));
    return isNaN(value) ? 1 : value;
  }

  saveSpeed(speed) {
    localStorage.setItem("carplayer_speed", speed);
  }

  getSpeed() {
    const value = parseFloat(localStorage.getItem("carplayer_speed"));
    return isNaN(value) ? 1 : value;
  }

  saveVideoBuffer(seconds) {
    localStorage.setItem("carplayer_video_buffer", seconds);
  }

  getVideoBuffer() {
    const value = parseFloat(localStorage.getItem("carplayer_video_buffer"));
    return isNaN(value) ? 30 : value;
  }

  savePreferredQualityId(qualityId) {
    const normalizedQualityId = String(qualityId || "").trim().toLowerCase();
    if (!normalizedQualityId) {
      localStorage.removeItem("carplayer_quality_id");
      return;
    }
    localStorage.setItem("carplayer_quality_id", normalizedQualityId);
  }

  getPreferredQualityId() {
    return String(localStorage.getItem("carplayer_quality_id") || "").trim().toLowerCase();
  }

  extractId(urlOrId) {
    const raw = String(urlOrId || "").trim();

    // For Jellyfin URLs, keep the full jellyfin-item:// URL as the ID
    // so that parseSessionUrl can recognize it later in the render loop
    if (raw.startsWith("jellyfin-item://")) {
      return raw;
    }

    return raw;
  }

  savePlaybackPos(url, time, duration) {
    if (!url) return;

    const id = this.extractId(url);
    const history = this.getHistory();
    const item = history.find((entry) => entry.id === id);

    if (item) {
      item.position = time;
      item.duration = duration || 0;
    } else {
      history.unshift({
        id,
        title: "",
        sourceType: this.#getSourceTypeFromId(id),
        position: time,
        duration: duration || 0,
      });
      if (history.length > 20) history.pop();
    }

    localStorage.setItem("carplayer_history", JSON.stringify(history));
  }

  getPlaybackPos(url) {
    const id = this.extractId(url);
    const history = this.getHistory();
    const item = history.find((entry) => entry.id === id);
    if (!item) return { time: 0, duration: 0 };
    return { time: item.position || 0, duration: item.duration || 0 };
  }

  addHistory(url, title = "", extras = {}) {
    if (!url) return;

    const id = this.extractId(url);
    const history = this.getHistory();
    const existingIdx = history.findIndex((entry) => entry.id === id);

    let item = {
      id,
      title,
      sourceType: extras.sourceType || this.#getSourceTypeFromId(id),
      position: 0,
      duration: 0,
    };
    if (existingIdx !== -1) {
      item = history[existingIdx];
      if (title) item.title = title;
      if (extras.sourceType) item.sourceType = extras.sourceType;
      if (!item.sourceType) {
        item.sourceType = this.#getSourceTypeFromId(id);
      }
      history.splice(existingIdx, 1);
    }
    if (extras.thumbnailUrl) item.thumbnailUrl = String(extras.thumbnailUrl);

    history.unshift(item);
    if (history.length > 20) history.pop();

    localStorage.setItem("carplayer_history", JSON.stringify(history));
    this.renderHistory();
  }

  updateHistoryItem(url, updates) {
    const id = this.extractId(url);
    const history = this.getHistory();
    const item = history.find((entry) => entry.id === id);
    if (!item) return;

    Object.assign(item, updates);
    if (!item.sourceType) {
      item.sourceType = this.#getSourceTypeFromId(id);
    }
    localStorage.setItem("carplayer_history", JSON.stringify(history));
  }

  saveManualCaptionUrl(url, captionUrl) {
    if (!url) return;

    const id = this.extractId(url);
    const history = this.getHistory();
    const item = history.find((entry) => entry.id === id);
    const safeCaptionUrl = String(captionUrl || "").trim();

    if (item) {
      if (safeCaptionUrl) {
        item.manualCaptionUrl = safeCaptionUrl;
      } else {
        delete item.manualCaptionUrl;
      }
      localStorage.setItem("carplayer_history", JSON.stringify(history));
      return;
    }

    if (!safeCaptionUrl) return;

    history.unshift({
      id,
      title: this.#app.getVideoTitleFromUrl(url),
      sourceType: this.#getSourceTypeFromId(id),
      position: 0,
      duration: 0,
      manualCaptionUrl: safeCaptionUrl,
    });
    if (history.length > 20) history.pop();

    localStorage.setItem("carplayer_history", JSON.stringify(history));
  }

  getManualCaptionUrl(url) {
    if (!url) return "";

    const id = this.extractId(url);
    const history = this.getHistory();
    const item = history.find((entry) => entry.id === id);
    return String(item?.manualCaptionUrl || "").trim();
  }

  saveHistoryThumbnail(url, thumbnailDataUrl) {
    if (!url) return;
    if (!thumbnailDataUrl || typeof thumbnailDataUrl !== "string") return;
    if (!thumbnailDataUrl.startsWith("data:image/")) return;

    try {
      const id = this.extractId(url);
      const history = this.getHistory();
      const existing = history.find((entry) => entry.id === id);

      if (existing) {
        existing.thumbnailDataUrl = thumbnailDataUrl;
      } else {
        history.unshift({
          id,
          title: this.#app.getVideoTitleFromUrl(url),
          sourceType: this.#getSourceTypeFromId(id),
          position: 0,
          duration: 0,
          thumbnailDataUrl,
        });
        if (history.length > 20) history.pop();
      }

      localStorage.setItem("carplayer_history", JSON.stringify(history));
    } catch (error) {
      console.warn("Unable to persist history thumbnail.", error);
    }
  }

  removeHistory(idToRemove) {
    const history = this.getHistory().filter((entry) => entry.id !== idToRemove);
    localStorage.setItem("carplayer_history", JSON.stringify(history));
    this.renderHistory();
  }

  clearHistory() {
    localStorage.removeItem("carplayer_history");
    localStorage.removeItem("carplayer_positions");

    this.renderHistory();
  }

  getHistory() {
    const historyJson = localStorage.getItem("carplayer_history") || "[]";
    try {
      return JSON.parse(historyJson);
    } catch (error) {
      return [];
    }
  }

  renderHistory(filterQuery = "") {
    this.#historyRenderer?.render(filterQuery);
  }

  getTheme() {
    return localStorage.getItem("carplayer_theme") === "light" ? "light" : "dark";
  }

  saveTheme(theme) {
    localStorage.setItem("carplayer_theme", theme === "light" ? "light" : "dark");
  }

  getWidgetLayout() {
    return this.#readJson("carplayer_widgets", null);
  }

  saveWidgetLayout(layout) {
    this.#writeJson("carplayer_widgets", layout);
  }

  getTodos() {
    return this.#readJson("carplayer_todos", []);
  }

  saveTodos(todos) {
    this.#writeJson("carplayer_todos", todos);
  }

  getTubeConfig() {
    return {
      proxyUrl: "",
      // carplayer_youtube is where the config lived before the rename.
      ...(this.#readJson("carplayer_tube", null) || this.#readJson("carplayer_youtube", {})),
    };
  }

  saveTubeConfig(config) {
    this.#writeJson("carplayer_tube", config);
  }

  getIptvConfig() {
    return {
      playlistUrl: "",
      epgUrl: "",
      corsProxy: "",
      ...this.#readJson("carplayer_iptv", {}),
    };
  }

  saveIptvConfig(config) {
    this.#writeJson("carplayer_iptv", config);
  }

  /**
   * True once if an earlier version auto-added default stations to the favorites; clears the marker.
   */
  takeRadioDefaultsFlag() {
    const keys = ["carplayer_radio_defaults_version", "carplayer_radio_defaults_v1"];
    const wasSet = keys.some((key) => localStorage.getItem(key) !== null);
    keys.forEach((key) => localStorage.removeItem(key));
    return wasSet;
  }

  /**
   * Favorite IPTV channels: { key, name, url, logo }, key from channelFavoriteKey() (tvg-id, or the name).
   * The stream link is kept so the dashboard can play a channel without loading the playlist. Older versions
   * stored only the key; such entries get their link the next time the playlist loads.
   */
  getIptvFavorites() {
    const stored = this.#readJson("carplayer_iptv_favorites", []);
    if (!Array.isArray(stored)) return [];
    return stored
      .map((entry) => (typeof entry === "string" ? { key: entry, name: entry, url: "", logo: "" } : entry))
      .filter((entry) => entry && typeof entry.key === "string" && entry.key);
  }

  saveIptvFavorites(favorites) {
    this.#writeJson("carplayer_iptv_favorites", favorites);
  }

  /**
   * Videos saved with the heart in the player: { id, title, sourceType, thumbnailUrl }, newest first. The id is the
   * history id (link, Tube watch link or jellyfin-item://), so the dashboard plays it the way history does.
   * Captured frame thumbnails are not copied: they are large and settings export sends every saved key.
   */
  getVideoFavorites() {
    const stored = this.#readJson("carplayer_video_favorites", []);
    return Array.isArray(stored) ? stored.filter((entry) => entry && typeof entry.id === "string" && entry.id) : [];
  }

  isVideoFavorite(url) {
    const id = this.extractId(url);
    return Boolean(id) && this.getVideoFavorites().some((entry) => entry.id === id);
  }

  /** Adds or removes a video; returns true when it is a favorite afterwards. */
  toggleVideoFavorite(url, { title = "" } = {}) {
    const id = this.extractId(url);
    if (!id) return false;
    const favorites = this.getVideoFavorites();
    if (favorites.some((entry) => entry.id === id)) {
      this.#writeJson("carplayer_video_favorites", favorites.filter((entry) => entry.id !== id));
      return false;
    }
    const historyItem = this.getHistory().find((entry) => entry.id === id);
    this.#writeJson("carplayer_video_favorites", [{
      id,
      title: historyItem?.title || title || this.#app.getVideoTitleFromUrl(id),
      sourceType: historyItem?.sourceType || this.#getSourceTypeFromId(id),
      thumbnailUrl: historyItem?.thumbnailUrl || "",
    }, ...favorites]);
    return true;
  }

  getRadioFavorites() {
    return this.#readJson("carplayer_radio_favorites", []);
  }

  saveRadioFavorites(stations) {
    this.#writeJson("carplayer_radio_favorites", stations);
  }

  /**
   * Settings snapshot for QR / relay transfer between devices.
   * History, playback positions and captured thumbnails stay on the device: they are large and device specific.
   */
  exportSettings() {
    const snapshot = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (this.#isTransferableKey(key)) snapshot[key] = localStorage.getItem(key);
    }
    return snapshot;
  }

  importSettings(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return 0;
    let imported = 0;
    Object.entries(snapshot).forEach(([key, value]) => {
      if (!this.#isTransferableKey(key) || typeof value !== "string") return;
      localStorage.setItem(key, value);
      imported += 1;
    });
    return imported;
  }

  #isTransferableKey(key) {
    return typeof key === "string"
      && key.startsWith("carplayer_")
      && !["carplayer_history", "carplayer_positions", "carplayer_active_tab"].includes(key);
  }

  #readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  #writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  #getSourceTypeFromId(id) {
    return String(id || "").startsWith("jellyfin-item://") ? "jellyfin" : "url";
  }
}
