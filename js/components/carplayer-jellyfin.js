import VideoTileRenderer from "../video-tile-renderer.js";

/**
 * <carplayer-jellyfin> - Jellyfin tab: server setup card, or search plus "continue watching" and "last added" rows.
 *
 * Methods: setConfig({serverUrl, apiKey, videoCodec, videoBuffer}), setRows(rows), showSearch(serverUrl, apiKey, query), hideSearch()
 *   rows: [{ id, title, loading?, error?, items?: [{id, name, thumb, type, year}], serverBaseUrl }]
 * Events: 'save-config' {serverUrl, apiKey, videoCodec, videoBuffer}, 'search' {query}, 'play-jellyfin' {itemId, title, serverBaseUrl},
 *         'view-change' {setup}
 */
export default class CarplayerJellyfin extends HTMLElement {
  #rendered = false;
  #configured = false;

  connectedCallback() {
    if (this.#rendered) return;
    this.#rendered = true;

    this.innerHTML = `
      <div class="tab-view">
        <div class="tab-view__setup hidden" data-role="setup">
          <carplayer-setup-card heading="Connect Jellyfin" icon="library"
            note="Add your Jellyfin server to search your library and play it here."
            phone-step='Paste the server address and API key, then tap "Send to Car".'>
            <label class="field-label">Server address
              <carplayer-clearable-input data-field="serverUrl" type="url" placeholder="https://jellyfin.example.com" class="field field--url"></carplayer-clearable-input>
            </label>
            <label class="field-label">API key
              <carplayer-clearable-input data-field="apiKey" type="text" placeholder="Paste your Jellyfin API key" class="field field--url"></carplayer-clearable-input>
            </label>
            <div class="field-label">Video codec
              <carplayer-custom-select data-field="videoCodec" title="Video Codec" value="h264" class="custom-select--large">
                <option value="h264" selected>H.264 (safest)</option>
                <option value="h265">H.265 HEVC (smaller files)</option>
                <option value="av1">AV1</option>
              </carplayer-custom-select>
            </div>
            <label class="field-label">Video buffer (seconds)
              <carplayer-clearable-input data-field="videoBuffer" type="number" placeholder="30" class="field field--url"></carplayer-clearable-input>
            </label>
            <div class="button-row">
              <button class="btn btn--primary" data-action="save" type="button">Save server</button>
              <button class="btn btn--ghost hidden" data-action="cancel" type="button">Cancel</button>
            </div>
            <ul class="setup-facts">
              <li>Create the API key in Jellyfin: Dashboard, API Keys.</li>
            </ul>
          </carplayer-setup-card>
        </div>

        <div class="tab-view__main hidden" data-role="main">
          <div class="tab-toolbar">
            <form class="tab-search" data-role="search-form" autocomplete="on">
              <span class="icon icon--sm icon-mask icon-mask--search" aria-hidden="true"></span>
              <input class="tab-search__input" name="jellyfin_query" type="search" placeholder="Search movies and episodes" />
              <button class="btn btn--primary btn--compact" type="submit">Search</button>
            </form>
            <button class="icon-btn" data-action="edit" type="button" title="Jellyfin server" aria-label="Jellyfin server settings">
              <span class="icon icon--md icon-mask icon-mask--settings" aria-hidden="true"></span>
            </button>
          </div>
          <carplayer-jellyfin-search-results class="hidden" data-role="results"></carplayer-jellyfin-search-results>
          <div class="library-rows" data-role="rows"></div>
        </div>
      </div>
    `;

    this.querySelector('[data-action="save"]').addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("save-config", { detail: this.#readForm() }));
    });
    this.querySelector('[data-action="cancel"]').addEventListener("click", () => this.#showSetup(false));
    this.querySelector('[data-action="edit"]').addEventListener("click", () => this.#showSetup(true));
    this.querySelector('[data-role="search-form"]').addEventListener("submit", (event) => {
      event.preventDefault();
      const query = event.target.elements.jellyfin_query.value.trim();
      if (query) this.dispatchEvent(new CustomEvent("search", { detail: { query } }));
    });
    this.querySelector('[data-role="results"]').addEventListener("back", () => this.hideSearch());
    // Tiles from search results and from the rows share the same markup; the results component also emits this.
    this.querySelector('[data-role="rows"]').addEventListener("click", (event) => {
      const tile = event.target.closest('[data-play-type="jellyfin"]');
      if (!tile) return;
      this.dispatchEvent(new CustomEvent("play-jellyfin", {
        bubbles: true,
        detail: {
          itemId: tile.dataset.itemId,
          title: decodeURIComponent(tile.dataset.videoTitle || ""),
          serverBaseUrl: tile.dataset.serverBaseUrl,
        },
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
    this.#configured = Boolean(config.serverUrl && config.apiKey);
    this.querySelectorAll("[data-field]").forEach((input) => {
      input.value = String(config[input.dataset.field] ?? "");
    });
    this.#showSetup(!this.#configured);
  }

  showSearch(serverUrl, apiKey, query) {
    this.querySelector('[data-role="search-form"]').elements.jellyfin_query.value = query;
    const results = this.querySelector('[data-role="results"]');
    results.setAttribute("server-url", serverUrl);
    results.setAttribute("api-key", apiKey);
    results.setAttribute("query", query);
    results.classList.remove("hidden");
    this.querySelector('[data-role="rows"]').classList.add("hidden");
  }

  hideSearch() {
    this.querySelector('[data-role="search-form"]').elements.jellyfin_query.value = "";
    const results = this.querySelector('[data-role="results"]');
    results.classList.add("hidden");
    results.removeAttribute("query");
    this.querySelector('[data-role="rows"]').classList.remove("hidden");
  }

  setRows(rows) {
    const container = this.querySelector('[data-role="rows"]');
    container.replaceChildren(...rows.map((row) => {
      const section = document.createElement("section");
      section.className = "library-row";
      const heading = document.createElement("h3");
      heading.className = "library-row__title";
      heading.textContent = row.title;
      section.appendChild(heading);

      if (row.loading || row.error || !row.items?.length) {
        const note = document.createElement("p");
        note.className = row.error ? "text-error-state" : "widget-note";
        note.textContent = row.loading ? "Loading..." : (row.error || "Nothing here yet.");
        section.appendChild(note);
        return section;
      }

      const list = document.createElement("div");
      list.className = "widget-row";
      list.replaceChildren(...row.items.map((item) => VideoTileRenderer.createJellyfinSearchTile({
        id: item.id,
        title: item.name,
        thumbnailUrl: item.thumb,
        typeText: item.type,
        year: item.year,
        serverBaseUrl: row.serverBaseUrl,
      })));
      section.appendChild(list);
      return section;
    }));
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
      config[input.dataset.field] = String(input.value ?? "").trim();
    });
    return config;
  }
}

customElements.define("carplayer-jellyfin", CarplayerJellyfin);
