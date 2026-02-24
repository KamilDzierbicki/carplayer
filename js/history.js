import VideoTileRenderer from "./video-tile-renderer.js";

export default class HistoryRenderer {
  #app;
  #storage;
  #container;
  #actions;

  constructor(app, storage) {
    this.#app = app;
    this.#storage = storage;
    this.#container = document.getElementById("historyItems");
    this.#actions = {
      playUrl: () => {},
      playYoutube: () => {},
      shareUrl: () => {},
      openUrlModal: () => {},
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
      let isYouTube = false;
      let ytVideoId = "";
      let fullUrl = id;

      if (id && id.length === 11 && !id.includes("/") && !id.includes(":")) {
        isYouTube = true;
        ytVideoId = id;
        fullUrl = `https://www.youtube.com/watch?v=${id}`;
        if (!filename) filename = `YouTube Video (${ytVideoId})`;
      } else {
        try {
          const parsed = new URL(id);
          const ytMatch = id.match(this.#app.youtubeRegex);

          if (ytMatch && ytMatch[1]) {
            isYouTube = true;
            ytVideoId = ytMatch[1];
            fullUrl = `https://www.youtube.com/watch?v=${ytVideoId}`;
            if (!filename) filename = `YouTube Video (${ytVideoId})`;
          } else if (!filename) {
            const paths = parsed.pathname.split("/");
            const last = paths[paths.length - 1];
            if (last) filename = decodeURIComponent(last);
          }
        } catch (error) {
          // Ignore malformed URL and keep fallback title.
        }
      }

      const thumbUrl = isYouTube ? `https://i.ytimg.com/vi/${ytVideoId}/hqdefault.jpg` : "";

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
        isYouTube,
        youtubeVideoId: ytVideoId,
        thumbnailUrl: thumbUrl,
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
        const encodedId = removeBtn.dataset.historyId || "";
        this.#storage.removeHistory(decodeURIComponent(encodedId));
        return;
      }

      const shareBtn = event.target.closest('[data-action="share-video"]');
      if (shareBtn) {
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

    if (playType === "youtube") {
      const videoId = playTarget.dataset.videoId || "";
      const encodedTitle = playTarget.dataset.videoTitle || "";
      const title = encodedTitle ? decodeURIComponent(encodedTitle) : "";
      this.#actions.playYoutube(videoId, title);
      return;
    }

    if (playType === "url") {
      const encodedUrl = playTarget.dataset.videoUrl || "";
      this.#actions.playUrl(decodeURIComponent(encodedUrl));
    }
  }

}
