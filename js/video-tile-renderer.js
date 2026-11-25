export default class VideoTileRenderer {
  static createHistoryTile({
    id,
    title,
    fullUrl,
    sourceType = "url",
    sourceId = "",
    sourceServerBaseUrl = "",
    thumbnailUrl,
    placeholderThumbnailUrl,
    progressPercent,
  }) {
    const safeTitle = String(title || "");
    const encodedId = encodeURIComponent(String(id || ""));
    const encodedFullUrl = encodeURIComponent(String(fullUrl || ""));
    const encodedTitle = encodeURIComponent(safeTitle);
    const escapedTitleAttr = this.#escapeAttr(safeTitle);
    const titleHtml = this.#escapeHtml(safeTitle);
    const safeSourceId = this.#escapeAttr(String(sourceId || ""));
    const safeSourceServerBaseUrl = this.#escapeAttr(String(sourceServerBaseUrl || ""));
    const playType = sourceType === "jellyfin" ? "jellyfin" : "url";

    const safeProgress = Number.isFinite(progressPercent) ? progressPercent : 0;
    const progressHtml = `
      <div class="tile-progress-container">
        <div class="tile-progress-fill" style="width: ${safeProgress}%;"></div>
      </div>
    `;

    const actionsHtml = this.#buildHistoryActions({
      encodedId,
      encodedFullUrl,
      sourceType,
      sourceId,
      sourceServerBaseUrl,
    });

    const activeThumbUrl = sourceType === "jellyfin"
      ? (this.#escapeUrlForCss(placeholderThumbnailUrl) || this.#escapeUrlForCss(thumbnailUrl))
      : (this.#escapeUrlForCss(placeholderThumbnailUrl) || this.#escapeUrlForCss(thumbnailUrl) || "");

    const thumbnailHtml = this.#buildSharedThumbnail({
      activeThumbUrl,
      progressHtml,
      actionsHtml
    });

    const tile = document.createElement("div");
    tile.className = "video-tile";
    tile.setAttribute("data-action", "play-video");
    tile.setAttribute("data-play-type", playType);
    if (playType === "jellyfin") {
      tile.setAttribute("data-item-id", safeSourceId);
      tile.setAttribute("data-server-base-url", safeSourceServerBaseUrl);
      tile.setAttribute("data-video-title", encodedTitle);
    } else {
      tile.setAttribute("data-video-url", encodedFullUrl);
    }

    tile.innerHTML = `
      ${thumbnailHtml}
      <div class="tile-info">
        <div class="tile-title" role="button" tabindex="0" title="${escapedTitleAttr}">${titleHtml}</div>
      </div>
    `;
    return tile;
  }

  static createJellyfinSearchTile({
    id,
    title,
    durationText,
    thumbnailUrl,
    typeText,
    year,
    serverBaseUrl,
  }) {
    const safeIdAttr = this.#escapeAttr(String(id || ""));
    const safeTitle = String(title || "");
    const safeType = String(typeText || "");
    const safeYear = Number(year) > 0 ? String(year) : "";
    const safeDuration = String(durationText || "");
    const safeServerBaseUrl = this.#escapeAttr(String(serverBaseUrl || ""));
    const encodedTitle = encodeURIComponent(safeTitle);
    const escapedTitleAttr = this.#escapeAttr(safeTitle);
    const safeThumbnailUrl = this.#escapeUrlForCss(thumbnailUrl);
    const titleHtml = this.#escapeHtml(safeTitle);
    const metaText = [safeType, safeYear].filter(Boolean).join(" • ");
    const metaHtml = this.#escapeHtml(metaText);
    const durationHtml = this.#escapeHtml(safeDuration);

    const tile = document.createElement("div");
    tile.className = "video-tile";
    tile.setAttribute("data-action", "play-video");
    tile.setAttribute("data-play-type", "jellyfin");
    tile.setAttribute("data-item-id", safeIdAttr);
    tile.setAttribute("data-server-base-url", safeServerBaseUrl);
    tile.setAttribute("data-video-title", encodedTitle);

    const thumbnailHtml = this.#buildSharedThumbnail({
      activeThumbUrl: safeThumbnailUrl,
      durationHtml
    });

    tile.innerHTML = `
      ${thumbnailHtml}
      <div class="tile-info">
        <div class="tile-title" role="button" tabindex="0" title="${escapedTitleAttr}">${titleHtml}</div>
      </div>
      <div class="video-meta">${metaHtml}</div>
    `;
    return tile;
  }

  static createTubeSearchTile({ id, title, durationText, thumbnailUrl, channelName, viewCountText }) {
    const safeTitle = String(title || "");
    const metaText = [channelName, viewCountText].filter(Boolean).join(" • ");

    const tile = document.createElement("div");
    tile.className = "video-tile";
    tile.setAttribute("data-action", "play-video");
    tile.setAttribute("data-play-type", "tube");
    tile.setAttribute("data-video-id", this.#escapeAttr(String(id || "")));
    tile.setAttribute("data-video-title", encodeURIComponent(safeTitle));

    const thumbnailHtml = this.#buildSharedThumbnail({
      activeThumbUrl: this.#escapeUrlForCss(thumbnailUrl),
      durationHtml: this.#escapeHtml(String(durationText || "")),
    });

    tile.innerHTML = `
      ${thumbnailHtml}
      <div class="tile-info">
        <div class="tile-title" role="button" tabindex="0" title="${this.#escapeAttr(safeTitle)}">${this.#escapeHtml(safeTitle)}</div>
      </div>
      <div class="video-meta">${this.#escapeHtml(metaText)}</div>
    `;
    return tile;
  }

  /**
   * Tile for the dashboard Favorites widget. Channel and station logos are shown whole; `cover` fills the tile
   * with a video thumbnail instead.
   */
  static createFavoriteTile({ playType, key, title, logoUrl, metaText, cover = false }) {
    const safeTitle = String(title || "");
    const logo = this.#escapeUrlForCss(logoUrl);

    const tile = document.createElement("div");
    tile.className = "video-tile";
    tile.setAttribute("data-action", "play-video");
    tile.setAttribute("data-play-type", playType);
    tile.setAttribute("data-favorite-key", this.#escapeAttr(String(key || "")));

    tile.innerHTML = `
      <div class="tile-thumbnail ${cover && logo ? "tile-thumbnail--cover" : "tile-thumbnail--logo"}"${logo ? ` style="background-image: url('${logo}');"` : ""}>
        ${logo ? "" : `<span class="tile-thumbnail__initials">${this.#escapeHtml(initials(safeTitle))}</span>`}
      </div>
      <div class="tile-info">
        <div class="tile-title" role="button" tabindex="0" title="${this.#escapeAttr(safeTitle)}">${this.#escapeHtml(safeTitle)}</div>
      </div>
      <div class="video-meta">${this.#escapeHtml(String(metaText || ""))}</div>
    `;
    return tile;
  }

  static #buildSharedThumbnail({ activeThumbUrl, durationHtml, progressHtml, actionsHtml }) {
    const hasThumb = Boolean(activeThumbUrl);
    const thumbClass = hasThumb ? "tile-thumbnail tile-thumbnail--cover" : "tile-thumbnail";
    const thumbStyle = hasThumb ? ` style="background-image: url('${activeThumbUrl}');"` : "";

    return `
      <div class="${thumbClass}"${thumbStyle}>
        ${durationHtml ? `<div class="duration-badge">${durationHtml}</div>` : ""}
        ${actionsHtml || ""}
        ${progressHtml || ""}
      </div>
    `;
  }

  static #buildHistoryActions({
    encodedId,
    encodedFullUrl,
    sourceType,
    sourceId,
    sourceServerBaseUrl,
  }) {
    const shareData = sourceType === "jellyfin"
      ? `data-share-type="jellyfin" data-item-id="${this.#escapeAttr(String(sourceId || ""))}" data-server-base-url="${this.#escapeAttr(String(sourceServerBaseUrl || ""))}"`
      : `data-video-url="${encodedFullUrl}" data-share-type="url"`;

    return `
      <div class="tile-actions">
        <button class="tile-action-btn" data-action="remove-history" data-history-id="${encodedId}" title="Remove from history" type="button">
          <span class="icon icon--sm icon-mask icon-mask--close" aria-hidden="true"></span>
        </button>
      </div>
      <button class="tile-share-btn-bottom" data-action="share-video" ${shareData} title="Share link" type="button">
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

  /** URL safe inside style="background-image: url('...')": allowed schemes only, quotes and brackets encoded. */
  static #escapeUrlForCss(value) {
    const url = String(value || "").trim();
    if (!/^(https?:|data:image\/|blob:)/i.test(url)) return "";
    return url.replace(/["'()\\<>\s]/g, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
  }
}

function initials(name) {
  return name.replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}
