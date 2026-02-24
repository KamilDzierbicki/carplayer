import VideoTileRenderer from "./video-tile-renderer.js";
import JellyfinService from "./jellyfin.js";

export default class HistoryRenderer {
  #storage;
  #container;
  #actions;

  constructor(_app, storage) {
    this.#storage = storage;
    this.#container = document.getElementById("historyItems");
    this.#actions = {
      playUrl: () => { },
      playJellyfin: () => { },
      shareUrl: () => { },
      openUrlModal: () => { },
    };

    this.#bindDelegatedActions();
  }

  setActions(actions) {
    this.#actions = {
      ...this.#actions,
      ...actions,
    };
  }

  render(filterQuery = "") {
    const historyTitleElement = document.getElementById("historyTitle");
    const historyHeaderElement = document.getElementById("historyHeader");
    const clearHistoryButton = document.getElementById("btnClearHistory");
    const history = this.#storage.getHistory();

    if (historyTitleElement) historyTitleElement.textContent = "Recently Played";
    if (clearHistoryButton) clearHistoryButton.classList.remove("hidden");
    if (historyHeaderElement) {
      historyHeaderElement.classList.toggle("hidden", history.length === 0);
    }

    const loader = document.getElementById("loader");
    if (loader) loader.classList.remove("is-visible");

    if (!this.#container) return;
    this.#container.innerHTML = "";

    const q = filterQuery.toLowerCase();
    let visibleCount = 0;

    history.forEach((item) => {
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
        // Legacy fallback: raw Jellyfin item ID stored before the extractId fix
        sourceType = "jellyfin";
        sourceId = id;
        sourceServerBaseUrl = this.#storage.getJellyfinServerUrl() || "";
      }

      if (sourceType === "jellyfin" && sourceId) {
        fullUrl = JellyfinService.buildBrowserItemUrl(sourceServerBaseUrl, sourceId);
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

      const thumbUrl = sourceType === "jellyfin" ? String(item.thumbnailUrl || "") : "";
      const placeholderThumbnailUrl = String(item.thumbnailDataUrl || "");

      if (
        q &&
        !filename.toLowerCase().includes(q) &&
        !(fullUrl || "").toLowerCase().includes(q)
      ) {
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

      this.#container.appendChild(tile);
    });

    if (q && visibleCount === 0) {
      this.#container.innerHTML = '<div class="text-empty-state">No matching history items found.</div>';
      return;
    }

    if (!q && visibleCount === 0) {
      if (historyHeaderElement) historyHeaderElement.classList.add("hidden");
      this.#container.innerHTML = `
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

  #bindDelegatedActions() {
    if (!this.#container) return;

    this.#container.addEventListener("click", (event) => {
      const removeBtn = event.target.closest('[data-action="remove-history"]');
      if (removeBtn) {
        event.stopPropagation();
        const encodedId = removeBtn.dataset.historyId || "";
        if (encodedId) this.#storage.removeHistory(decodeURIComponent(encodedId));
        return;
      }

      const shareBtn = event.target.closest('[data-action="share-video"]');
      if (shareBtn) {
        event.stopPropagation();
        const shareType = shareBtn.dataset.shareType || "url";
        if (shareType === "jellyfin") {
          const itemId = (shareBtn.dataset.itemId || "").trim();
          const serverBaseUrl = (shareBtn.dataset.serverBaseUrl || "").trim();
          const shareUrl = JellyfinService.buildBrowserItemUrl(serverBaseUrl, itemId);
          if (shareUrl) this.#actions.shareUrl(shareUrl);
          return;
        }

        const encodedUrl = shareBtn.dataset.videoUrl || "";
        this.#actions.shareUrl(decodeURIComponent(encodedUrl));
        return;
      }

      const playTarget = event.target.closest('[data-action="play-video"]');
      if (playTarget) {
        this.#handlePlayAction(playTarget);
        return;
      }

      const openUrlModalBtn = event.target.closest('[data-action="open-url-modal"]');
      if (openUrlModalBtn) {
        this.#actions.openUrlModal();
      }
    });
  }

  #handlePlayAction(playTarget) {
    const playType = playTarget.dataset.playType;

    if (playType === "jellyfin") {
      const itemId = playTarget.dataset.itemId || "";
      const serverBaseUrl = playTarget.dataset.serverBaseUrl || "";
      const encodedTitle = playTarget.dataset.videoTitle || "";
      const title = encodedTitle ? decodeURIComponent(encodedTitle) : "";
      this.#actions.playJellyfin(itemId, title, serverBaseUrl);
      return;
    }

    if (playType === "url") {
      const encodedUrl = playTarget.dataset.videoUrl || "";
      const url = decodeURIComponent(encodedUrl);

      const parsed = JellyfinService.parseSessionUrl(url);
      if (parsed) {
        const title = this.#storage.getHistory().find(h => h.id === url)?.title || "";
        this.#actions.playJellyfin(parsed.itemId, title, parsed.serverBaseUrl);
        return;
      }

      this.#actions.playUrl(url);
    }
  }

}
