/**
 * <carplayer-radio> - Radio tab: favorites, popular stations and search results as station cards.
 *
 * Methods: setSection(name), setStations(section, {stations, loading, error}), setFavorites(stations),
 *          setNowPlaying(stationId)
 * Events: 'search' {query}, 'section-change' {section}, 'play-station' {station}, 'toggle-favorite' {station},
 *         'open-add-station'
 */
const SECTIONS = Object.freeze([
  { id: "favorites", label: "My stations" },
  { id: "popular", label: "Popular" },
  { id: "results", label: "Search results" },
]);

export default class CarplayerRadio extends HTMLElement {
  #rendered = false;
  #section = "favorites";
  #data = { favorites: { stations: [] }, popular: { stations: [] }, results: { stations: [] } };
  #favoriteIds = new Set();
  #nowPlayingId = "";

  connectedCallback() {
    if (this.#rendered) return;
    this.#rendered = true;

    this.innerHTML = `
      <div class="tab-view">
        <div class="tab-toolbar">
          <form class="tab-search" data-role="search-form" autocomplete="on">
            <span class="icon icon--sm icon-mask icon-mask--search" aria-hidden="true"></span>
            <input class="tab-search__input" name="radio_query" type="search" placeholder="Search radio stations by name" />
            <button class="btn btn--primary btn--compact" type="submit">Search</button>
          </form>
          <button class="btn btn--dark btn--compact" data-action="add-station" type="button">
            <span class="icon icon--sm icon-mask icon-mask--plus" aria-hidden="true"></span>
            Add station
          </button>
        </div>
        <div class="chip-row" data-role="sections">
          ${SECTIONS.map((section) => `<button class="chip" type="button" data-section="${section.id}">${section.label}</button>`).join("")}
        </div>
        <div class="station-grid" data-role="stations"></div>
      </div>
    `;

    this.querySelector('[data-role="search-form"]').addEventListener("submit", (event) => {
      event.preventDefault();
      const query = event.target.elements.radio_query.value.trim();
      if (query) this.dispatchEvent(new CustomEvent("search", { detail: { query } }));
    });
    this.querySelector('[data-action="add-station"]').addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("open-add-station"));
    });
    this.querySelector('[data-role="sections"]').addEventListener("click", (event) => {
      const chip = event.target.closest("[data-section]");
      if (!chip) return;
      this.setSection(chip.dataset.section);
      this.dispatchEvent(new CustomEvent("section-change", { detail: { section: chip.dataset.section } }));
    });
    this.querySelector('[data-role="stations"]').addEventListener("click", (event) => {
      const card = event.target.closest("[data-station-id]");
      if (!card) return;
      const station = this.#findStation(card.dataset.stationId);
      if (!station) return;
      const eventName = event.target.closest('[data-action="favorite"]') ? "toggle-favorite" : "play-station";
      this.dispatchEvent(new CustomEvent(eventName, { detail: { station } }));
    });

    this.#render();
  }

  get section() {
    return this.#section;
  }

  setSection(section) {
    this.#section = SECTIONS.some((entry) => entry.id === section) ? section : "favorites";
    this.#render();
  }

  setStations(section, state) {
    this.#data[section] = { stations: [], ...state };
    if (section === this.#section) this.#render();
  }

  setFavorites(stations) {
    this.#favoriteIds = new Set(stations.map((station) => station.id));
    this.#data.favorites = { stations };
    this.#render();
  }

  setNowPlaying(stationId) {
    this.#nowPlayingId = stationId || "";
    this.#render();
  }

  #findStation(id) {
    return Object.values(this.#data).flatMap((entry) => entry.stations || []).find((station) => station.id === id);
  }

  #render() {
    if (!this.#rendered) return;
    this.querySelectorAll("[data-section]").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.section === this.#section);
    });

    const container = this.querySelector('[data-role="stations"]');
    const { stations = [], loading = false, error = "" } = this.#data[this.#section] || {};

    if (loading) {
      container.innerHTML = '<div class="text-empty-state"><div class="loader loader-inline is-visible"></div><div class="loader-text">Loading stations...</div></div>';
      return;
    }
    if (error || !stations.length) {
      const message = document.createElement("div");
      message.className = error ? "text-error-state" : "text-empty-state";
      message.textContent = error || (this.#section === "favorites"
        ? "No stations yet. Tap the heart on any station, or add your own with Add station."
        : "No stations found.");
      container.replaceChildren(message);
      return;
    }

    container.replaceChildren(...stations.map((station) => this.#buildCard(station)));
  }

  #buildCard(station) {
    const card = document.createElement("div");
    card.className = "station-card";
    card.classList.toggle("is-playing", station.id === this.#nowPlayingId);
    card.classList.toggle("is-unplayable", !station.playable);
    card.dataset.stationId = station.id;
    card.innerHTML = `
      <span class="station-card__logo"></span>
      <span class="station-card__text" role="button" tabindex="0">
        <span class="station-card__name"></span>
        <span class="station-card__meta"></span>
      </span>
      <button class="icon-btn icon-btn--compact station-card__fav" data-action="favorite" type="button">
        <span class="icon icon--sm icon-mask" aria-hidden="true"></span>
      </button>
    `;

    const logo = card.querySelector(".station-card__logo");
    logo.textContent = String(station.name).replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean).slice(0, 2)
      .map((part) => part[0]).join("").toUpperCase();
    if (station.favicon) {
      const img = document.createElement("img");
      img.src = station.favicon;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("load", () => logo.replaceChildren(img), { once: true });
    }

    card.querySelector(".station-card__name").textContent = station.name;
    card.querySelector(".station-card__meta").textContent = station.playable
      ? [station.country, station.tags].filter(Boolean).join(" • ")
      : station.unplayableReason;

    const isFavorite = this.#favoriteIds.has(station.id);
    const fav = card.querySelector('[data-action="favorite"]');
    fav.setAttribute("aria-label", isFavorite ? "Remove from favorites" : "Add to favorites");
    fav.classList.toggle("is-active", isFavorite);
    fav.querySelector(".icon").classList.add(isFavorite ? "icon-mask--heart" : "icon-mask--heart-outline");
    return card;
  }
}

customElements.define("carplayer-radio", CarplayerRadio);
