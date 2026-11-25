// radio-browser.info: free community station directory with CORS. "all." resolves to one of its mirrors.
const RADIO_API = "https://all.api.radio-browser.info/json";
const LIST_QUERY = "order=clickcount&reverse=true&hidebroken=true&limit=60";

// Stations missing from radio-browser.info. They only join search results that match their name: nothing is shown
// or added to "My stations" without the user's search and tap.
const EXTRA_STATIONS = Object.freeze([
  ["Radio Yanosik '80s", "uwey4ye0gfcwv"],
  ["Radio Yanosik '90s", "v4d29stdpbpwv"],
  ["Radio Yanosik Rock", "whxxccsdp7uvv"],
  ["Radio Yanosik EDM", "s4exa6c6y33vv"],
  ["Radio Yanosik Love", "8fqn8rr6ktuvv"],
  ["Radio Yanosik Road", "4r4nzs58rquvv"],
  ["Radio Yanosik Classic", "vhxpw5w3rbpwv"],
  ["Radio Yanosik Disco Polo", "4z2yaey3rbpwv"],
  ["Radio Yanosik X-MAS", "b667d2c0qxcwv"],
].map(([name, streamId]) => ({
  stationuuid: `extra-${streamId}`, name, url_resolved: `https://stream.rcs.revma.com/${streamId}`,
  countrycode: "PL", tags: "",
})));

/** Internet radio: station directory, favorites in localStorage and playback through a plain <audio> element. */
export default class RadioController {
  #app;
  #storage;
  #share;
  #view;
  #bar;
  #audio = new Audio();
  #current = null;
  #popularLoaded = false;

  constructor({ app, storage, share }) {
    this.#app = app;
    this.#storage = storage;
    this.#share = share;
    this.#view = document.getElementById("radioComponent");
    this.#bar = document.getElementById("radioBar");
    this.#audio.preload = "none";

    this.#bindEvents();
  }

  /** Plays a station from "My stations", used by the dashboard Favorites widget. */
  playFavorite(stationId) {
    const station = this.#storage.getRadioFavorites().find((entry) => entry.id === stationId);
    if (station) this.#play(station);
  }

  init() {
    // Earlier versions put the featured list into "My stations" automatically ("default-" ids); take those out once.
    if (this.#storage.takeRadioDefaultsFlag()) {
      this.#storage.saveRadioFavorites(this.#storage.getRadioFavorites().filter((station) => !String(station.id).startsWith("default-")));
    }
    const favorites = this.#storage.getRadioFavorites();
    this.#view?.setFavorites(favorites);
    // Nothing is pre-added: without own stations the tab opens on the popular list (loaded when the tab opens).
    this.#view?.setSection(favorites.length ? "favorites" : "popular");
  }

  #bindEvents() {
    // Skips the native "search" event of <input type="search">, which bubbles here with no detail.
    this.#view?.addEventListener("search", (event) => {
      if (event.detail?.query) void this.#search(event.detail.query);
    });
    this.#view?.addEventListener("section-change", (event) => {
      if (event.detail.section === "popular") void this.#loadPopular();
    });
    this.#view?.addEventListener("play-station", (event) => this.#play(event.detail.station));
    this.#view?.addEventListener("toggle-favorite", (event) => this.#toggleFavorite(event.detail.station));
    this.#view?.addEventListener("open-add-station", () => this.#app.openModal("addStationModal"));
    // Same pattern as the other setup flows: type it here, or send it from a phone with the QR code.
    this.#share.registerMobileMode("radioshare", "mobileRadioModal");
    this.#share.registerPayloadHandler("radio-station", (value) => {
      if (this.#addCustomStation(value)) this.#app.closeModal("addStationModal");
    });
    document.addEventListener("modal-open", (event) => {
      if (event.target?.id !== "addStationModal" || this.#share.isPhoneRelayMode()) return;
      void this.#share.showRelayQr(event.target.querySelector("carplayer-setup-card")?.qrContainer, "radioshare", 200);
    });
    document.getElementById("btnAddStation")?.addEventListener("click", () => {
      const name = document.getElementById("addStationName");
      const url = document.getElementById("addStationUrl");
      if (this.#addCustomStation({ name: name?.value, url: url?.value })) {
        name.value = "";
        url.value = "";
        this.#app.closeModal("addStationModal");
      }
    });
    document.getElementById("btnSendRadioStation")?.addEventListener("click", async () => {
      const name = String(document.getElementById("mobileRadioNameInput")?.value || "").trim();
      const url = String(document.getElementById("mobileRadioUrlInput")?.value || "").trim();
      if (!url) {
        alert("Paste the stream link first.");
        return;
      }
      if (await this.#share.sendPayloadToCar({ type: "radio-station", value: { name, url } })) {
        this.#app.closeModal("mobileRadioModal");
        alert("Station sent to the car.");
      }
    });

    document.addEventListener("tab-change", (event) => {
      if (event.detail.tab === "radio" && this.#view?.section === "popular") void this.#loadPopular();
    });
    // Video playback and screen mirroring take over the speakers.
    document.addEventListener("playback-start", () => this.#stop());
    document.addEventListener("mirror-start", () => this.#stop());

    this.#bar?.addEventListener("radio-toggle", () => this.#togglePlay());
    this.#bar?.addEventListener("radio-stop", () => this.#stop());
    this.#bar?.addEventListener("radio-favorite", () => this.#current && this.#toggleFavorite(this.#current));

    ["playing", "pause", "waiting", "error"].forEach((type) => {
      this.#audio.addEventListener(type, () => this.#syncBar());
    });
  }

  async #fetchStations(query) {
    const response = await fetch(`${RADIO_API}/stations/search?${query}&${LIST_QUERY}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const items = await response.json();
    return items.map((item) => this.#normalize(item));
  }

  async #loadPopular(force = false) {
    if (this.#popularLoaded && !force) return;
    this.#view.setStations("popular", { loading: true });
    try {
      // Worldwide, most listened first: the app has no home country.
      const stations = await this.#fetchStations("");
      this.#popularLoaded = true;
      this.#view.setStations("popular", { stations });
    } catch (error) {
      this.#view.setStations("popular", { error: `Could not load stations (${error.message}).` });
    }
  }

  async #search(query) {
    this.#view.setSection("results");
    this.#view.setStations("results", { loading: true });
    const needle = query.toLowerCase();
    const extras = EXTRA_STATIONS.filter((item) => item.name.toLowerCase().includes(needle)).map((item) => this.#normalize(item));
    try {
      const stations = await this.#fetchStations(`name=${encodeURIComponent(query)}`);
      this.#view.setStations("results", { stations: [...stations, ...extras] });
    } catch (error) {
      if (extras.length) this.#view.setStations("results", { stations: extras });
      else this.#view.setStations("results", { error: `Search failed (${error.message}).` });
    }
  }

  /** @returns {boolean} whether the station was added */
  #addCustomStation({ name, url }) {
    const station = this.#normalize({ name: String(name || "").trim(), url_resolved: String(url || "").trim(), countrycode: "", tags: "own link" });
    if (!/^https?:\/\//i.test(station.url)) {
      alert("Enter a stream link that starts with http:// or https://");
      return false;
    }
    station.id = `custom-${station.url}`;
    const favorites = this.#storage.getRadioFavorites().filter((entry) => entry.id !== station.id);
    this.#saveFavorites([station, ...favorites]);
    this.#view.setSection("favorites");
    if (station.playable) this.#play(station);
    else alert(station.unplayableReason);
    return true;
  }

  #toggleFavorite(station) {
    const favorites = this.#storage.getRadioFavorites();
    const exists = favorites.some((entry) => entry.id === station.id);
    this.#saveFavorites(exists ? favorites.filter((entry) => entry.id !== station.id) : [...favorites, station]);
  }

  #saveFavorites(favorites) {
    this.#storage.saveRadioFavorites(favorites);
    this.#view?.setFavorites(favorites);
    this.#syncBar();
  }

  #play(station) {
    if (!station.playable) {
      alert(station.unplayableReason);
      return;
    }
    this.#current = station;
    this.#audio.src = station.url;
    this.#audio.volume = Math.min(1, Math.max(0, this.#storage.getVolume()));
    this.#audio.play().catch((error) => {
      console.warn("[Radio] play failed", error);
      this.#syncBar(`Cannot play this station (${error.message}).`);
    });
    this.#view?.setNowPlaying(station.id);
    this.#syncBar("Connecting...");
  }

  #togglePlay() {
    if (!this.#current) return;
    if (this.#audio.paused) {
      // Reconnect instead of resuming: a live stream resumed from its buffer plays stale audio.
      this.#play(this.#current);
    } else {
      this.#audio.pause();
    }
  }

  #stop() {
    if (!this.#current) return;
    this.#audio.pause();
    this.#audio.removeAttribute("src");
    this.#audio.load();
    this.#current = null;
    this.#view?.setNowPlaying("");
    this.#bar?.hide();
  }

  #syncBar(status = "") {
    if (!this.#current) return;
    const favorite = this.#storage.getRadioFavorites().some((entry) => entry.id === this.#current.id);
    const playing = !this.#audio.paused;
    const error = this.#audio.error ? "Stream error. Try another station." : "";
    this.#bar?.show({ station: this.#current, playing, favorite, status: status || error });
  }

  #normalize(item) {
    const url = String(item.url_resolved || item.url || "");
    let unplayableReason = "";
    if (Number(item.hls) === 1) {
      unplayableReason = "HLS radio streams are not supported.";
    } else if (window.location.protocol === "https:" && url.startsWith("http:")) {
      unplayableReason = "Plain HTTP stream, blocked on this HTTPS page.";
    }

    return {
      id: String(item.stationuuid || url),
      name: String(item.name || "").trim() || "Radio station",
      url,
      favicon: String(item.favicon || "").startsWith("https:") ? String(item.favicon) : "",
      country: String(item.countrycode || ""),
      tags: String(item.tags || "").split(",").slice(0, 3).join(", "),
      playable: Boolean(url) && !unplayableReason,
      unplayableReason,
    };
  }
}
