import VideoTileRenderer from "../video-tile-renderer.js";
import { Jellyfin } from "../jellyfin.js";

class CarplayerJellyfinSearchResults extends HTMLElement {
    #state = {
        loading: false,
        error: null,
        results: []
    };
    #jf = null;

    static get observedAttributes() {
        return ['query', 'server-url', 'api-key'];
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (oldVal !== newVal) {
            this.#handleParametersChange();
        }
    }

    #eventsBound = false;

    connectedCallback() {
        if (!this.#eventsBound) {
            this.#bindEvents();
            this.#eventsBound = true;
        }
        this.#render();
    }

    #bindEvents() {
        this.addEventListener('click', (event) => {
            const playTarget = event.target.closest('[data-action="play-video"]');
            if (playTarget && playTarget.dataset.playType === "jellyfin") {
                const itemId = playTarget.dataset.itemId || "";
                const serverBaseUrl = playTarget.dataset.serverBaseUrl || "";
                const encodedTitle = playTarget.dataset.videoTitle || "";
                const title = encodedTitle ? decodeURIComponent(encodedTitle) : "";

                this.dispatchEvent(new CustomEvent('play-jellyfin', {
                    detail: { itemId, title, serverBaseUrl },
                    bubbles: true, composed: true
                }));
            }
        });
    }

    #handleParametersChange() {
        const query = this.getAttribute('query');
        const serverUrl = this.getAttribute('server-url');
        const apiKey = this.getAttribute('api-key');

        if (!query || !serverUrl || !apiKey) {
            this.#updateState({ results: [], loading: false, error: null });
            return;
        }

        this.#jf = new Jellyfin(serverUrl, apiKey);
        this.#fetchResults(query);
    }

    async #fetchResults(query) {
        this.#updateState({ loading: true, error: null, results: [] });
        try {
            const results = await this.#jf.search(query);
            this.#updateState({ results: results || [], loading: false });
        } catch (error) {
            console.error("Jellyfin search error:", error);
            this.#updateState({ error: error.message, loading: false });
        }
    }

    #updateState(newState) {
        this.#state = { ...this.#state, ...newState };
        this.#render();
    }

    #render() {
        const { loading, error, results } = this.#state;
        const query = this.getAttribute('query') || "";
        const serverUrl = this.getAttribute('server-url') || "";

        this.innerHTML = `
            <div class="history-header">
                <h2 class="history-header__title">
                    <button class="btn-back-search" id="btnBackFromSearch" type="button" title="Back to Recently Played">
                        <span class="icon icon--sm icon-mask icon-mask--back" aria-hidden="true"></span>
                    </button>
                    Search Results
                </h2>
            </div>
            <div id="resultsContainer" class="video-grid">
                ${loading ? '<div class="loader is-visible" aria-hidden="true" style="margin: 20px auto;"></div>' : ''}
                ${error ? `<div class="text-empty-state">Search failed: ${error}</div>` : ''}
                ${!loading && !error && results.length === 0 && query ? `<div class="text-empty-state">No results found for "${query}".</div>` : ''}
            </div>
        `;

        if (results.length > 0 && !loading && !error) {
            const container = this.querySelector('#resultsContainer');
            const fragment = document.createDocumentFragment();
            results.forEach(item => {
                const tile = VideoTileRenderer.createJellyfinSearchTile({
                    id: item.id,
                    title: item.name,
                    thumbnailUrl: item.thumb,
                    typeText: item.type,
                    year: item.year,
                    serverBaseUrl: serverUrl
                });
                fragment.appendChild(tile);
            });
            container.appendChild(fragment);
        }

        const backBtn = this.querySelector('#btnBackFromSearch');
        if (backBtn) {
            backBtn.onclick = () => {
                this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
            };
        }
    }
}

customElements.define("carplayer-jellyfin-search-results", CarplayerJellyfinSearchResults);
