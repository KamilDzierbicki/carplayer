import VideoTileRenderer from "../video-tile-renderer.js";

/**
 * <carplayer-youtube> - YouTube tab: proxy setup card or search + results.
 *
 * Methods: setConfig({proxyUrl}), showResults(state)
 * Events: 'save-config' {proxyUrl}, 'search' {query},
 *         'play-youtube' {id, title}, 'edit-config'
 */
export default class CarplayerYoutube extends HTMLElement {
  #rendered = false;
  #configured = false;

  connectedCallback() {
    if (this.#rendered) return;
    this.#rendered = true;

    this.innerHTML = `
      <div class="tab-view">
        <div class="tab-view__setup hidden" data-role="setup">
          <carplayer-setup-card heading="Connect a CORS proxy for YouTube"
            note="YouTube does not allow other websites to read it, so search and video files go through a CORS proxy. The proxy must forward POST requests and Range headers. Use {url} where the encoded address goes, or the address is appended at the end. Videos play in 360p."
            phone-step='Paste the proxy address and tap "Send to Car".'>
            <carplayer-clearable-input data-field="proxyUrl" type="text" placeholder="https://proxy.example/?url={url}" class="field field--url"></carplayer-clearable-input>
            <div class="button-row">
              <button class="btn btn--primary" data-action="save" type="button">Save proxy</button>
              <button class="btn btn--ghost hidden" data-action="cancel" type="button">Cancel</button>
            </div>
          </carplayer-setup-card>
        </div>

        <div class="tab-view__main hidden" data-role="main">
          <div class="tab-toolbar">
            <form class="tab-search" data-role="search-form" autocomplete="on">
              <span class="icon icon--sm icon-mask icon-mask--search" aria-hidden="true"></span>
              <input class="tab-search__input" name="youtube_query" type="search" placeholder="Search YouTube or paste a YouTube link" />
              <button class="btn btn--primary btn--compact" type="submit">Search</button>
            </form>
            <button class="icon-btn" data-action="edit" type="button" title="Proxy settings" aria-label="Proxy settings">
              <span class="icon icon--md icon-mask icon-mask--settings" aria-hidden="true"></span>
            </button>
          </div>
          <div class="video-grid" data-role="results"></div>
        </div>
      </div>
    `;

    this.querySelector('[data-action="save"]').addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("save-config", { detail: this.#readForm() }));
    });
    this.querySelector('[data-action="cancel"]').addEventListener("click", () => this.#showSetup(false));
    this.querySelector('[data-action="edit"]').addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("edit-config"));
      this.#showSetup(true);
    });
    this.querySelector('[data-role="search-form"]').addEventListener("submit", (event) => {
      event.preventDefault();
      const query = event.target.elements.youtube_query.value.trim();
      if (query) this.dispatchEvent(new CustomEvent("search", { detail: { query } }));
    });
    this.querySelector('[data-role="results"]').addEventListener("click", (event) => {
      const tile = event.target.closest('[data-play-type="youtube"]');
      if (!tile) return;
      this.dispatchEvent(new CustomEvent("play-youtube", {
        detail: { id: tile.dataset.videoId, title: decodeURIComponent(tile.dataset.videoTitle || "") },
      }));
    });
  }

  get qrContainer() {
    return this.querySelector("carplayer-setup-card")?.qrContainer || null;
  }

  get isSetupVisible() {
    return !this.querySelector('[data-role="setup"]').classList.contains("hidden");
  }

  setConfig(config) {
    this.#configured = Boolean(config.proxyUrl);
    this.querySelectorAll("[data-field]").forEach((input) => {
      input.value = config[input.dataset.field] || "";
    });
    this.#showSetup(!this.#configured);
  }

  /** @param {{loading?: boolean, error?: string, videos?: Array, empty?: string}} state */
  showResults({ loading = false, error = "", videos = [], empty = "" }) {
    const container = this.querySelector('[data-role="results"]');
    if (loading) {
      container.innerHTML = '<div class="text-empty-state"><div class="loader loader-inline is-visible"></div><div class="loader-text">Searching YouTube...</div></div>';
      return;
    }
    if (error || !videos.length) {
      container.innerHTML = "";
      const message = document.createElement("div");
      message.className = error ? "text-error-state" : "text-empty-state";
      message.textContent = error || empty || "Search for a video to start.";
      container.appendChild(message);
      return;
    }
    container.replaceChildren(...videos.map((video) => VideoTileRenderer.createYouTubeSearchTile(video)));
  }

  #showSetup(visible) {
    this.querySelector('[data-role="setup"]').classList.toggle("hidden", !visible);
    this.querySelector('[data-role="main"]').classList.toggle("hidden", visible);
    this.querySelector('[data-action="cancel"]').classList.toggle("hidden", !this.#configured);
    this.dispatchEvent(new CustomEvent("view-change", { detail: { setup: visible } }));
  }

  #readForm() {
    const config = {};
    this.querySelectorAll("[data-field]").forEach((input) => {
      config[input.dataset.field] = input.value.trim();
    });
    return config;
  }
}

customElements.define("carplayer-youtube", CarplayerYoutube);
