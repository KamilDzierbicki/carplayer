import { withCorsProxy } from "./cors-proxy.js";

// radio-browser.info: free community station directory with CORS. "all." resolves to one of its mirrors.
const RADIO_API = "https://all.api.radio-browser.info/json";
const LIST_QUERY = "order=clickcount&reverse=true&hidebroken=true&limit=60";
// "Popular in XX" chips after the listener's own country: the directory's countries with the most stations.
const TOP_COUNTRIES = 12;
// An address that has not started playing by then is given up for the next one (some HTTPS ports never answer).
const FALLBACK_AFTER_MS = 8000;
// Favorites saved by earlier versions carry this reason; such stations now play over HTTPS or through the proxy.
const OLD_HTTP_REASON = "Plain HTTP stream, blocked on this HTTPS page.";
const NEEDS_PROXY_MESSAGE = "This station streams only over plain HTTP, which the browser blocks here. "
  + "Add your CORS proxy in the Tube or IPTV settings to play it.";

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

/**
 * The listener's country from the browser language ("de-AT" -> AT; "de" -> DE as its likeliest region),
 * or "" when the browser does not say.
 */
function browserCountry() {
  try {
    const region = new Intl.Locale(navigator.language || "").maximize().region || "";
    return /^[A-Z]{2}$/.test(region) ? region : "";
  } catch {
    return "";
  }
}

function compact(text) {
  return text.replace(/[^\p{L}\p{N}]/gu, "");
}

/** Internet radio: station directory, favorites in localStorage and playback through a plain <audio> element. */
export default class RadioController {
  #app;
  #storage;
  #share;
  #view;
  #bar;
  #audio = new Audio();
  #current = null;
  // Stream addresses still to try for the current station, the timer that moves on to them, whether the station
  // has started playing at all, and whether it is an HTTP-only station that would need a proxy nobody set up.
  #fallbacks = [];
  #fallbackTimer = 0;
  #started = false;
  #needsProxy = false;
  // Station URL -> the address that last played it, so a known HTTP-only station skips the HTTPS attempt.
  #workingUrls = new Map();
  #loadedSections = new Set();
  #countriesLoaded = false;
  #country = browserCountry();

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
    const saved = this.#storage.getRadioFavorites();
    if (saved.some((station) => station.unplayableReason === OLD_HTTP_REASON)) {
      this.#storage.saveRadioFavorites(saved.map((station) => (station.unplayableReason === OLD_HTTP_REASON
        ? { ...station, playable: Boolean(station.url), unplayableReason: "" }
        : station)));
    }
    const favorites = this.#storage.getRadioFavorites();
    this.#view?.setFavorites(favorites);
    this.#view?.setPopularCountries(this.#country ? [this.#country] : []);
    // Nothing is pre-added: without own stations the tab opens on the popular list of the browser's country.
    this.#view?.setSection(favorites.length ? "favorites" : this.#popularSection());
  }

  #bindEvents() {
    // Skips the native "search" event of <input type="search">, which bubbles here with no detail.
    this.#view?.addEventListener("search", (event) => {
      if (event.detail?.query) void this.#search(event.detail.query);
    });
    this.#view?.addEventListener("section-change", (event) => {
      if (event.detail.section.startsWith("popular")) void this.#loadPopular(event.detail.section);
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
      if (event.detail.tab !== "radio") return;
      void this.#loadCountries();
      if (this.#view?.section.startsWith("popular")) void this.#loadPopular(this.#view.section);
    });
    // Video playback and screen mirroring take over the speakers.
    document.addEventListener("playback-start", () => this.#stop());
    document.addEventListener("mirror-start", () => this.#stop());

    this.#bar?.addEventListener("radio-toggle", () => this.#togglePlay());
    this.#bar?.addEventListener("radio-stop", () => this.#stop());
    this.#bar?.addEventListener("radio-favorite", () => this.#current && this.#toggleFavorite(this.#current));

    this.#audio.addEventListener("playing", () => this.#onPlaying());
    this.#audio.addEventListener("error", () => this.#onStreamError());
    ["pause", "waiting"].forEach((type) => {
      this.#audio.addEventListener(type, () => this.#syncBar());
    });
  }

  async #fetchStations(query) {
    const response = await fetch(`${RADIO_API}/stations/search?${query}&${LIST_QUERY}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const items = await response.json();
    return items.map((item) => this.#normalize(item));
  }

  #popularSection() {
    return this.#country ? `popular:${this.#country}` : "popular";
  }

  /** Section "popular:PL" lists the most listened stations in PL; "popular" lists them worldwide. */
  async #loadPopular(section) {
    if (this.#loadedSections.has(section)) return;
    this.#loadedSections.add(section);
    this.#view.setStations(section, { loading: true });
    try {
      const code = section.split(":")[1] || "";
      const stations = await this.#fetchStations(code ? `countrycode=${code}` : "");
      this.#view.setStations(section, { stations });
    } catch (error) {
      this.#loadedSections.delete(section);
      this.#view.setStations(section, { error: `Could not load stations (${error.message}).` });
    }
  }

  /** Adds "Popular in XX" chips for the countries with the most stations, after the browser's own country. */
  async #loadCountries() {
    if (this.#countriesLoaded) return;
    this.#countriesLoaded = true;
    try {
      const response = await fetch(`${RADIO_API}/countries?order=stationcount&reverse=true&hidebroken=true`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const codes = (await response.json())
        .map((country) => String(country.iso_3166_1 || "").toUpperCase())
        .filter((code) => /^[A-Z]{2}$/.test(code) && code !== this.#country)
        .slice(0, TOP_COUNTRIES);
      const section = this.#view.section;
      this.#view.setPopularCountries([...(this.#country ? [this.#country] : []), ...codes]);
      this.#view.setSection(section);
    } catch (error) {
      // The browser's own country and the worldwide list still work without the country list.
      this.#countriesLoaded = false;
      console.warn("[Radio] country list failed", error);
    }
  }

  async #search(query) {
    this.#view.setSection("results");
    this.#view.setStations("results", { loading: true });
    // Every typed word must appear in the name, ignoring case, spaces and punctuation: "yanosik xmas" finds "X-MAS".
    const words = query.toLowerCase().split(/\s+/).map(compact).filter(Boolean);
    const extras = EXTRA_STATIONS
      .filter((item) => words.every((word) => compact(item.name.toLowerCase()).includes(word)))
      .map((item) => this.#normalize(item));
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
    // Stations saved before HLS support carry the old "not supported" flag; <audio> plays HLS natively now.
    if (!station.playable && !/^HLS radio streams/.test(String(station.unplayableReason || ""))) {
      alert(station.unplayableReason);
      return;
    }
    this.#current = station;
    this.#started = false;
    this.#audio.volume = Math.min(1, Math.max(0, this.#storage.getVolume()));
    this.#view?.setNowPlaying(station.id);
    const urls = this.#streamUrls(station.url);
    this.#needsProxy = urls.length === 1 && urls[0] !== station.url;
    this.#tryStream(urls);
  }

  /**
   * Addresses to try for a station, best first. An HTTPS page cannot load plain HTTP audio, so an http:// station
   * tries the same address over HTTPS (many servers have it) and then the user's CORS proxy, which serves it over
   * HTTPS. The address that played last time goes first.
   */
  #streamUrls(url) {
    if (window.location.protocol !== "https:" || !url.startsWith("http:")) return [url];
    const proxy = this.#storage.getTubeConfig().proxyUrl || this.#storage.getIptvConfig().corsProxy;
    const urls = [`https:${url.slice("http:".length)}`, ...(proxy ? [withCorsProxy(url, proxy)] : [])];
    const known = this.#workingUrls.get(url);
    return urls.includes(known) ? [known, ...urls.filter((entry) => entry !== known)] : urls;
  }

  #tryStream([url, ...fallbacks]) {
    clearTimeout(this.#fallbackTimer);
    this.#fallbacks = fallbacks;
    if (fallbacks.length || this.#needsProxy) {
      this.#fallbackTimer = setTimeout(() => this.#onStreamError(), FALLBACK_AFTER_MS);
    }
    this.#audio.src = url;
    this.#audio.play().catch((error) => {
      // A failed address also fires "error", which moves on; AbortError means another address replaced this one.
      if (error.name === "NotSupportedError" || error.name === "AbortError") return;
      console.warn("[Radio] play failed", error);
      this.#syncBar(`Cannot play this station (${error.message}).`);
    });
    this.#syncBar("Connecting...");
  }

  #onPlaying() {
    clearTimeout(this.#fallbackTimer);
    this.#fallbacks = [];
    if (this.#current && !this.#started) {
      this.#started = true;
      this.#workingUrls.set(this.#current.url, this.#audio.src);
    }
    this.#syncBar();
  }

  #onStreamError() {
    if (!this.#current) return;
    if (this.#fallbacks.length) {
      this.#tryStream(this.#fallbacks);
      return;
    }
    clearTimeout(this.#fallbackTimer);
    this.#workingUrls.delete(this.#current.url);
    if (!this.#needsProxy || this.#started) {
      this.#syncBar();
      return;
    }
    // The HTTPS attempt failed or never answered: stop it, so it cannot start playing after the alert.
    this.#audio.pause();
    this.#audio.removeAttribute("src");
    this.#audio.load();
    this.#syncBar("Needs a CORS proxy.");
    alert(NEEDS_PROXY_MESSAGE);
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
    clearTimeout(this.#fallbackTimer);
    this.#fallbacks = [];
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
