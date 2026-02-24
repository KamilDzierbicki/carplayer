import JellyfinService from "./jellyfin.js";

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

  addHistory(url, title = "") {
    if (!url) return;

    const id = this.extractId(url);
    const history = this.getHistory();
    const existingIdx = history.findIndex((entry) => entry.id === id);

    let item = {
      id,
      title,
      sourceType: this.#getSourceTypeFromId(id),
      position: 0,
      duration: 0,
    };
    if (existingIdx !== -1) {
      item = history[existingIdx];
      if (title) item.title = title;
      if (!item.sourceType) {
        item.sourceType = this.#getSourceTypeFromId(id);
      }
      history.splice(existingIdx, 1);
    }

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

  #getSourceTypeFromId(id) {
    return String(id || "").startsWith("jellyfin-item://") ? "jellyfin" : "url";
  }
}
