export default class StorageService {
  #app;
  #historyRenderer = null;

  constructor(app) {
    this.#app = app;
  }

  setHistoryRenderer(historyRenderer) {
    this.#historyRenderer = historyRenderer;
  }

  saveApiKey(key) {
    localStorage.setItem("carplayer_yt_api_key", key);
  }

  getApiKey() {
    return localStorage.getItem("carplayer_yt_api_key") || "";
  }

  getApiQuotaMonth() {
    return localStorage.getItem("carplayer_api_quota_month") || "";
  }

  getApiQuotaUsage() {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const savedMonth = this.getApiQuotaMonth();
    if (savedMonth !== currentMonth) {
      localStorage.setItem("carplayer_api_quota_month", currentMonth);
      localStorage.setItem("carplayer_api_quota_count", "0");
      return 0;
    }

    return parseInt(localStorage.getItem("carplayer_api_quota_count"), 10) || 0;
  }

  incrementApiQuota() {
    const currentUsage = this.getApiQuotaUsage();
    localStorage.setItem("carplayer_api_quota_count", String(currentUsage + 1));
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

  extractId(urlOrId) {
    if (!urlOrId) return "";

    if (urlOrId.length === 11 && !urlOrId.includes("/") && !urlOrId.includes(":")) {
      return urlOrId;
    }

    const ytMatch = urlOrId.match(this.#app.youtubeRegex);
    return ytMatch ? ytMatch[1] : urlOrId;
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
      history.unshift({ id, title: "", position: time, duration: duration || 0 });
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

    let item = { id, title, position: 0, duration: 0 };
    if (existingIdx !== -1) {
      item = history[existingIdx];
      if (title) item.title = title;
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
    localStorage.setItem("carplayer_history", JSON.stringify(history));
  }

  removeHistory(idToRemove) {
    const history = this.getHistory().filter((entry) => entry.id !== idToRemove);
    localStorage.setItem("carplayer_history", JSON.stringify(history));
    this.renderHistory();
  }

  clearHistory() {
    localStorage.removeItem("carplayer_history");
    localStorage.removeItem("carplayer_positions");

    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("yt_title_")) localStorage.removeItem(key);
    });

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
}
