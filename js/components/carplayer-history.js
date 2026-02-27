import VideoTileRenderer from "../video-tile-renderer.js";
import JellyfinService from "../jellyfin.js";

class CarplayerHistory extends HTMLElement {
    #s = { historyData: [], searchQuery: "" };

    set history(data) {
        this.update({ historyData: Array.isArray(data) ? data : [] });
    }

    get history() {
        return this.#s.historyData;
    }

    set searchQuery(query) {
        this.update({ searchQuery: query || "" });
    }

    get searchQuery() {
        return this.#s.searchQuery;
    }

    connectedCallback() {
        if (!this.innerHTML.trim()) {
            this.innerHTML = `
              <div class="history-header hidden" id="internalHistoryHeader">
                <h2 class="history-header__title">Recently Played</h2>
                <button id="internalBtnClearHistory" class="icon-btn icon-btn--compact" type="button">
                  Clear All History
                </button>
              </div>
              <div class="video-grid" id="internalHistoryItems"></div>
            `;
        }

        if (!this.dom) {
            this.dom = Object.fromEntries([...this.querySelectorAll('[id]')].map(el => [el.id, el]));
            this.#bindEvents();
        }

        this.#renderList();
    }

    update(newState) {
        this.#s = { ...this.#s, ...newState };
        this.#renderList();
    }

    #bindEvents() {
        this.addEventListener("click", (event) => {
            // Clear History Button
            if (event.target.closest('#internalBtnClearHistory')) {
                this.dispatchEvent(new CustomEvent('clear-history', { bubbles: true, composed: true }));
                return;
            }

            // Remove specific history item
            const removeBtn = event.target.closest('[data-action="remove-history"]');
            if (removeBtn) {
                event.stopPropagation();
                const encodedId = removeBtn.dataset.historyId || "";
                if (encodedId) {
                    this.dispatchEvent(new CustomEvent('remove-item', {
                        detail: { id: decodeURIComponent(encodedId) },
                        bubbles: true, composed: true
                    }));
                }
                return;
            }

            // Share item
            const shareBtn = event.target.closest('[data-action="share-video"]');
            if (shareBtn) {
                event.stopPropagation();
                const shareType = shareBtn.dataset.shareType || "url";
                if (shareType === "jellyfin") {
                    const itemId = (shareBtn.dataset.itemId || "").trim();
                    const serverBaseUrl = (shareBtn.dataset.serverBaseUrl || "").trim();
                    const shareUrl = JellyfinService.buildBrowserItemUrl(serverBaseUrl, itemId);
                    if (shareUrl) {
                        this.dispatchEvent(new CustomEvent('share-item', {
                            detail: { url: shareUrl },
                            bubbles: true, composed: true
                        }));
                    }
                    return;
                }

                const encodedUrl = shareBtn.dataset.videoUrl || "";
                this.dispatchEvent(new CustomEvent('share-item', {
                    detail: { url: decodeURIComponent(encodedUrl) },
                    bubbles: true, composed: true
                }));
                return;
            }

            // Play item
            const playTarget = event.target.closest('[data-action="play-video"]');
            if (playTarget) {
                const playType = playTarget.dataset.playType;

                if (playType === "jellyfin") {
                    const itemId = playTarget.dataset.itemId || "";
                    const serverBaseUrl = playTarget.dataset.serverBaseUrl || "";
                    const encodedTitle = playTarget.dataset.videoTitle || "";
                    const title = encodedTitle ? decodeURIComponent(encodedTitle) : "";

                    this.dispatchEvent(new CustomEvent('play-jellyfin', {
                        detail: { itemId, title, serverBaseUrl },
                        bubbles: true, composed: true
                    }));
                    return;
                }

                if (playType === "url") {
                    const encodedUrl = playTarget.dataset.videoUrl || "";
                    const url = decodeURIComponent(encodedUrl);

                    const parsed = JellyfinService.parseSessionUrl(url);
                    if (parsed) {
                        const title = this.#s.historyData.find(h => h.id === url)?.title || "";
                        this.dispatchEvent(new CustomEvent('play-jellyfin', {
                            detail: { itemId: parsed.itemId, title, serverBaseUrl: parsed.serverBaseUrl },
                            bubbles: true, composed: true
                        }));
                        return;
                    }

                    this.dispatchEvent(new CustomEvent('play-url', {
                        detail: { url },
                        bubbles: true, composed: true
                    }));
                }
                return;
            }

            // Open URL modal (from empty state)
            const openUrlModalBtn = event.target.closest('[data-action="open-url-modal"]');
            if (openUrlModalBtn) {
                this.dispatchEvent(new CustomEvent('open-url-modal', { bubbles: true, composed: true }));
            }
        });
    }

    // Helper method to extract item URL logic (moved from history.js)
    #extractItemData(item) {
        const id = item.id;
        let filename = item.title || "";
        let fullUrl = id;
        let sourceType = item.sourceType || "url";
        let sourceId = "";
        let sourceServerBaseUrl = "";

        const jellyfinSession = JellyfinService.parseSessionUrl(id);
        if (jellyfinSession?.itemId) {
            sourceType = "jellyfin";
            sourceId = jellyfinSession.itemId;
            sourceServerBaseUrl = jellyfinSession.serverBaseUrl || String(item.jellyfinServerBaseUrl || "");
        } else if (sourceType === "jellyfin") {
            sourceId = String(item.jellyfinItemId || "");
            sourceServerBaseUrl = String(item.jellyfinServerBaseUrl || "");
        } else if (/^[0-9a-f]{32}$/i.test(id)) {
            // Legacy fallback
            sourceType = "jellyfin";
            sourceId = id;
            // Note: We used to pull server URL from storage here. We might need it passed down or use empty.
            // Since it's a fallback, let's leave it empty unless provided on the item.
            sourceServerBaseUrl = String(item.jellyfinServerBaseUrl || "");
        }

        if (sourceType === "jellyfin" && sourceId) {
            if (sourceServerBaseUrl) {
                fullUrl = JellyfinService.buildBrowserItemUrl(sourceServerBaseUrl, sourceId);
            }
            if (!filename) filename = `Jellyfin Item (${sourceId})`;
        } else {
            try {
                const parsed = new URL(id);
                if (!filename) {
                    const paths = parsed.pathname.split("/");
                    const last = paths[paths.length - 1];
                    if (last) filename = decodeURIComponent(last);
                }
            } catch (error) {
                if (id && id.length === 11 && !id.includes("/") && !id.includes(":")) {
                    fullUrl = `https://www.youtube.com/watch?v=${id}`;
                    if (!filename) filename = `Legacy item (${id})`;
                }
            }
        }

        return { id, filename, fullUrl, sourceType, sourceId, sourceServerBaseUrl };
    }

    #renderList() {
        if (!this.dom || !this.dom.internalHistoryItems) return; // Not yet connected

        const { historyData, searchQuery } = this.#s;
        const header = this.dom.internalHistoryHeader;
        const container = this.dom.internalHistoryItems;

        const loader = document.getElementById("loader");
        if (loader) loader.classList.remove("is-visible");

        if (header) {
            header.classList.toggle("hidden", historyData.length === 0);
        }

        container.innerHTML = "";

        const q = searchQuery.toLowerCase();
        let visibleCount = 0;
        const fragment = document.createDocumentFragment();

        historyData.forEach((item) => {
            const { id, filename, fullUrl, sourceType, sourceId, sourceServerBaseUrl } = this.#extractItemData(item);
            const thumbUrl = sourceType === "jellyfin" ? String(item.thumbnailUrl || "") : "";
            const placeholderThumbnailUrl = String(item.thumbnailDataUrl || "");

            if (q && !filename.toLowerCase().includes(q) && !(fullUrl || "").toLowerCase().includes(q)) {
                return;
            }

            visibleCount += 1;

            let percent = 0;
            if (item.duration > 0 && item.position > 0) {
                percent = Math.min((item.position / item.duration) * 100, 100);
            }

            const tile = VideoTileRenderer.createHistoryTile({
                id,
                title: filename,
                fullUrl,
                sourceType,
                sourceId,
                sourceServerBaseUrl,
                thumbnailUrl: thumbUrl,
                placeholderThumbnailUrl,
                progressPercent: percent,
            });

            fragment.appendChild(tile);
        });

        if (visibleCount > 0) {
            container.appendChild(fragment);
        } else if (q && visibleCount === 0) {
            container.innerHTML = '<div class="text-empty-state">No matching history items found.</div>';
        } else if (!q && visibleCount === 0) {
            if (header) header.classList.add("hidden");
            container.innerHTML = `
        <div class="empty-history-placeholder">
          <img src="icons/catalog.svg" alt="No history yet" width="256" height="256" />
          <h3>Nothing played recently</h3>
          <p></p>
          <button class="btn btn--primary" data-action="open-url-modal" type="button">
            <span class="icon icon--sm icon-mask icon-mask--plus" aria-hidden="true"></span>
            Add Video to Watch
          </button>
        </div>
      `;
        }
    }
}

customElements.define("carplayer-history", CarplayerHistory);
