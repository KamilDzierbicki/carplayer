export default class VideoTileRenderer {
  static createHistoryTile({
    id,
    title,
    fullUrl,
    isYouTube,
    youtubeVideoId,
    thumbnailUrl,
    progressPercent,
  }) {
    const safeTitle = String(title || "");
    const encodedId = encodeURIComponent(String(id || ""));
    const encodedFullUrl = encodeURIComponent(String(fullUrl || ""));
    const encodedTitle = encodeURIComponent(safeTitle);
    const escapedTitleAttr = this.#escapeAttr(safeTitle);
    const titleHtml = this.#escapeHtml(safeTitle);
    const playData = isYouTube
      ? `data-video-id="${youtubeVideoId}" data-video-title="${encodedTitle}"`
      : `data-video-url="${encodedFullUrl}"`;
    const playType = isYouTube ? "youtube" : "url";
    const thumbnailHtml = this.#buildHistoryThumbnail({
      isYouTube,
      youtubeVideoId,
      encodedTitle,
      encodedFullUrl,
      encodedId,
      thumbnailUrl,
      progressPercent,
    });

    const tile = document.createElement("div");
    tile.className = "video-tile";
    tile.innerHTML = `
      ${thumbnailHtml}
      <div class="tile-info">
        <div class="tile-title" data-action="play-video" data-play-type="${playType}" ${playData} title="${escapedTitleAttr}">${titleHtml}</div>
      </div>
    `;
    return tile;
  }

  static createYouTubeSearchTile({
    id,
    title,
    durationText,
    thumbnailUrl,
    channelName,
    viewCountText,
  }) {
    const safeIdAttr = this.#escapeAttr(String(id || ""));
    const safeTitle = String(title || "");
    const safeChannelName = String(channelName || "");
    const safeViews = String(viewCountText || "");
    const safeDuration = String(durationText || "");
    const encodedTitle = encodeURIComponent(safeTitle);
    const escapedTitleAttr = this.#escapeAttr(safeTitle);
    const safeThumbnailUrl = this.#escapeUrlForCss(thumbnailUrl);
    const titleHtml = this.#escapeHtml(safeTitle);
    const metaHtml = this.#escapeHtml(`${safeChannelName} • ${safeViews}`);
    const durationHtml = this.#escapeHtml(safeDuration);

    const tile = document.createElement("div");
    tile.className = "video-tile";
    tile.innerHTML = `
      <div class="tile-thumbnail tile-thumbnail--cover" data-action="play-video" data-play-type="youtube" data-video-id="${safeIdAttr}" data-video-title="${encodedTitle}" style="background-image: url('${safeThumbnailUrl}');">
        <div class="duration-badge">${durationHtml}</div>
      </div>
      <div class="tile-info">
        <div class="tile-title" data-action="play-video" data-play-type="youtube" data-video-id="${safeIdAttr}" data-video-title="${encodedTitle}" title="${escapedTitleAttr}">${titleHtml}</div>
      </div>
      <div class="video-meta">${metaHtml}</div>
    `;
    return tile;
  }

  static #buildHistoryThumbnail({
    isYouTube,
    youtubeVideoId,
    encodedTitle,
    encodedFullUrl,
    encodedId,
    thumbnailUrl,
    progressPercent,
  }) {
    const safeYoutubeVideoId = this.#escapeAttr(String(youtubeVideoId || ""));
    const safeThumbUrl = this.#escapeUrlForCss(thumbnailUrl);
    const safeProgress = Number.isFinite(progressPercent) ? progressPercent : 0;
    const actionsHtml = this.#buildHistoryActions({
      encodedId,
      encodedFullUrl,
    });
    const progressHtml = `
      <div class="tile-progress-container">
        <div class="tile-progress-fill" style="width: ${safeProgress}%;"></div>
      </div>
    `;

    if (isYouTube) {
      return `
        <div class="tile-thumbnail tile-thumbnail--cover" data-action="play-video" data-play-type="youtube" data-video-id="${safeYoutubeVideoId}" data-video-title="${encodedTitle}" style="background-image: url('${safeThumbUrl}');">
          ${actionsHtml}
          ${progressHtml}
        </div>
      `;
    }

    return `
      <div class="tile-thumbnail" data-action="play-video" data-play-type="url" data-video-url="${encodedFullUrl}">
        <span class="icon icon-mask icon-mask--play-circle" aria-hidden="true"></span>
        ${actionsHtml}
        ${progressHtml}
      </div>
    `;
  }

  static #buildHistoryActions({ encodedId, encodedFullUrl }) {
    return `
      <div class="tile-actions">
        <button class="tile-action-btn" data-action="remove-history" data-history-id="${encodedId}" title="Remove from history" type="button">
          <span class="icon icon--sm icon-mask icon-mask--close" aria-hidden="true"></span>
        </button>
      </div>
      <button class="tile-share-btn-bottom" data-action="share-video" data-video-url="${encodedFullUrl}" title="Send to Car" type="button">
        <span class="icon icon--sm icon-mask icon-mask--share" aria-hidden="true"></span>
      </button>
    `;
  }

  static #escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  static #escapeAttr(value) {
    return this.#escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  static #escapeUrlForCss(value) {
    return String(value || "").replace(/'/g, "%27").replace(/\)/g, "%29");
  }
}
