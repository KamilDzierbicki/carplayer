import { channelFavoriteKey } from "../iptv-parsers.js";

/**
 * <carplayer-iptv> - IPTV tab: playlist setup card and a TV guide table (channels left, programme timeline right).
 * Channels without a program guide get an empty timeline row. Favorite channels are listed first and have their own chip.
 *
 * Methods: setConfig(config), setChannels({channels, status}), setGuide(guide), setStatus(text, isError)
 * Events: 'save-config' {playlistUrl, epgUrl, corsProxy}, 'reload', 'edit-config',
 *         'play-channel' {channelId}
 */
// Rows rendered above and below the visible part: a quick scroll shows no empty rows, and the rows are rebuilt
// only after scrolling this far.
const OVERSCAN_ROWS = 8;
const HOUR_MS = 3600 * 1000;
const HALF_HOUR_MS = HOUR_MS / 2;
const GUIDE_HOURS_AHEAD = 12;
const PX_PER_HOUR = 240;
const FAVORITES_GROUP = "\u2605favorites";

export default class CarplayerIptv extends HTMLElement {
  #rendered = false;
  #configured = false;
  #channels = [];
  #guide = new Map();
  #guideLoading = false;
  #favorites = new Set();
  #group = "";
  #query = "";
  #clockTimer = null;
  #filterTimer = null;
  #loading = false;
  #windowFrom = 0;
  // Virtual list: only the rows in view are in the DOM (see #renderSlice).
  #grid = null;
  #sliceRange = "";
  #sliceFrame = 0;
  #sizeObserver = null;

  connectedCallback() {
    if (this.#rendered) return;
    this.#rendered = true;

    this.innerHTML = `
      <div class="tab-view">
        <div class="tab-view__setup hidden" data-role="setup">
          <carplayer-setup-card heading="Set up IPTV" icon="tv"
            note="Add your channel list. The program guide is optional."
            phone-step='Paste the playlist and EPG links and tap "Send to Car".'>
            <label class="field-label">Playlist (M3U)
              <carplayer-clearable-input data-field="playlistUrl" type="url" placeholder="https://provider.example/playlist.m3u" class="field field--url"></carplayer-clearable-input>
            </label>
            <label class="field-label">Program guide (EPG, optional)
              <carplayer-clearable-input data-field="epgUrl" type="url" placeholder="https://provider.example/epg.xml.gz" class="field field--url"></carplayer-clearable-input>
            </label>
            <details class="setup-advanced">
              <summary>Advanced: CORS proxy</summary>
              <p class="section-note">Used for the playlist and the EPG when their server does not allow CORS. Without it, the proxy from the Tube tab is tried. Use {url} where the encoded address goes, or the address is appended at the end.</p>
              <carplayer-clearable-input data-field="corsProxy" type="text" placeholder="https://proxy.example/?url={url}" class="field field--url"></carplayer-clearable-input>
            </details>
            <div class="button-row">
              <button class="btn btn--primary" data-action="save" type="button">Save IPTV</button>
              <button class="btn btn--ghost hidden" data-action="cancel" type="button">Cancel</button>
            </div>
            <ul class="setup-facts">
              <li>Channels must be HLS streams (.m3u8) on HTTPS.</li>
              <li>The guide uses the XMLTV format, as .xml or .xml.gz.</li>
            </ul>
          </carplayer-setup-card>
        </div>

        <div class="tab-view__main hidden" data-role="main">
          <div class="tab-toolbar">
            <label class="tab-search">
              <span class="icon icon--sm icon-mask icon-mask--search" aria-hidden="true"></span>
              <input class="tab-search__input" data-role="filter" type="search" placeholder="Filter channels" />
            </label>
            <button class="icon-btn" data-action="reload" type="button" title="Reload playlist and EPG" aria-label="Reload playlist and EPG">
              <span class="icon icon--md icon-mask icon-mask--transfer" aria-hidden="true"></span>
            </button>
            <button class="icon-btn" data-action="edit" type="button" title="IPTV settings" aria-label="IPTV settings">
              <span class="icon icon--md icon-mask icon-mask--settings" aria-hidden="true"></span>
            </button>
          </div>
          <div class="chip-row" data-role="groups"></div>
          <p class="section-note iptv-status" data-role="status"></p>
          <div class="iptv-channels" data-role="list"></div>
        </div>
      </div>
    `;

    this.#bindEvents();
  }

  disconnectedCallback() {
    clearInterval(this.#clockTimer);
    this.#sizeObserver?.disconnect();
  }

  get qrContainer() {
    return this.querySelector("carplayer-setup-card")?.qrContainer || null;
  }

  get isSetupVisible() {
    return !this.querySelector('[data-role="setup"]').classList.contains("hidden");
  }

  setConfig(config) {
    this.#configured = Boolean(config.playlistUrl);
    this.querySelectorAll("[data-field]").forEach((input) => {
      input.value = config[input.dataset.field] || "";
    });
    this.#showSetup(!this.#configured);
  }

  /** While the playlist loads, the "No channels loaded" note stays hidden. */
  setLoading(loading) {
    this.#loading = Boolean(loading);
    if (!this.#channels.length) this.#renderList();
  }

  setChannels(channels) {
    this.#loading = false;
    this.#channels = channels;
    this.#group = "";
    this.#renderGroups();
    this.#renderList();
  }

  /** @param {string[]} keys favorite channel keys, see channelFavoriteKey() */
  setFavorites(keys) {
    this.#favorites = new Set(keys);
    if (this.#group === FAVORITES_GROUP && !this.#favorites.size) this.#group = "";
    if (!this.#channels.length) return;
    this.#renderGroups();
    this.#keepScroll(() => this.#renderList());
  }

  /** @param {{loading?: boolean}} options loading: the guide is still being downloaded */
  setGuide(guide, { loading = false } = {}) {
    this.#guide = guide;
    this.#guideLoading = loading;
    this.#renderList();
  }

  setStatus(text, isError = false) {
    const status = this.querySelector('[data-role="status"]');
    status.textContent = text || "";
    status.classList.toggle("is-error", Boolean(isError));
  }

  #bindEvents() {
    this.querySelector('[data-action="save"]').addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("save-config", { detail: this.#readForm() }));
    });
    this.querySelector('[data-action="cancel"]').addEventListener("click", () => this.#showSetup(false));
    this.querySelector('[data-action="reload"]').addEventListener("click", () => this.dispatchEvent(new CustomEvent("reload")));
    this.querySelector('[data-action="edit"]').addEventListener("click", () => this.#showSetup(true));

    // Rebuilding the table on every keystroke is slow with big playlists, so wait for a short pause in typing.
    this.querySelector('[data-role="filter"]').addEventListener("input", (event) => {
      this.#query = event.target.value.trim().toLowerCase();
      clearTimeout(this.#filterTimer);
      this.#filterTimer = setTimeout(() => this.#renderList(), 200);
    });

    this.querySelector('[data-role="groups"]').addEventListener("click", (event) => {
      const chip = event.target.closest("[data-group]");
      if (!chip) return;
      this.#group = chip.dataset.group;
      this.#renderGroups();
      this.#renderList();
    });

    this.querySelector('[data-role="list"]').addEventListener("click", (event) => {
      const favorite = event.target.closest("[data-favorite-key]");
      if (favorite) {
        const channelId = favorite.closest(".epg__channel")?.querySelector("[data-channel-id]")?.dataset.channelId;
        this.dispatchEvent(new CustomEvent("toggle-favorite", { detail: { key: favorite.dataset.favoriteKey, channelId } }));
        return;
      }
      this.#emitPlay(event.target.closest("[data-channel-id]")?.dataset.channelId);
    });
    // A logo that fails to load shows the channel initials; "error" does not bubble, so it is caught on the way down.
    this.querySelector('[data-role="list"]').addEventListener("error", (event) => {
      const logo = event.target.closest?.(".epg__logo");
      if (logo) logo.textContent = logo.dataset.initials || "";
    }, true);

    // Every minute: move the "now" line and the live highlight in place; rebuild only when the hour window moves.
    this.#clockTimer = setInterval(() => {
      if (!this.isConnected || this.closest(".hidden") || !this.#channels.length) return;
      this.#tick();
    }, 60000);
  }

  #tick() {
    const now = Date.now();
    const scroller = this.querySelector('[data-role="scroller"]');
    if (!scroller || startOfHour(now - HOUR_MS) !== this.#windowFrom) {
      this.#keepScroll(() => this.#renderList());
      return;
    }
    scroller.querySelector(".epg__now")?.style.setProperty("--epg-now", `${((now - this.#windowFrom) / HOUR_MS) * PX_PER_HOUR}px`);
    const corner = scroller.querySelector(".epg__corner");
    if (corner) corner.textContent = `Now ${formatClock(now)}`;
    scroller.querySelectorAll(".epg__programme").forEach((block) => {
      const start = Number(block.dataset.start);
      const stop = Number(block.dataset.stop);
      const live = start <= now && stop > now;
      const becameLive = live && !block.classList.contains("is-live");
      block.classList.toggle("is-past", stop <= now);
      block.classList.toggle("is-live", live);
      if (becameLive) {
        const subtitle = block.closest(".epg__row")?.querySelector(".epg__channel-now");
        if (subtitle) subtitle.textContent = block.querySelector(".epg__programme-title")?.textContent || "";
      }
    });
  }

  /** Re-renders without jumping: the table keeps the user's scroll position. */
  #keepScroll(render) {
    const scroller = this.querySelector('[data-role="scroller"]');
    const position = scroller ? { left: scroller.scrollLeft, top: scroller.scrollTop } : null;
    render();
    const next = this.querySelector('[data-role="scroller"]');
    if (position && next) next.scrollTo(position);
  }

  #emitPlay(channelId) {
    if (channelId) this.dispatchEvent(new CustomEvent("play-channel", { detail: { channelId } }));
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

  #renderGroups() {
    const groups = [...new Set(this.#channels.map((channel) => channel.group).filter(Boolean))].sort();
    const container = this.querySelector('[data-role="groups"]');
    const favoriteCount = this.#channels.filter((channel) => this.#isFavorite(channel)).length;
    const chips = ["", ...(favoriteCount ? [FAVORITES_GROUP] : []), ...groups];
    container.replaceChildren(...chips.map((group) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `chip${group === this.#group ? " is-active" : ""}`;
      chip.dataset.group = group;
      chip.textContent = group === FAVORITES_GROUP ? `Favorites (${favoriteCount})` : (group || `All (${this.#channels.length})`);
      return chip;
    }));
    container.classList.toggle("hidden", chips.length < 3);
  }

  #renderList() {
    const container = this.querySelector('[data-role="list"]');
    const matching = this.#channels.filter((channel) => {
      if (this.#group === FAVORITES_GROUP) {
        if (!this.#isFavorite(channel)) return false;
      } else if (this.#group && channel.group !== this.#group) {
        return false;
      }
      return !this.#query || channel.name.toLowerCase().includes(this.#query);
    });
    // Favorites first, otherwise in playlist order.
    const shown = [...matching.filter((channel) => this.#isFavorite(channel)), ...matching.filter((channel) => !this.#isFavorite(channel))];

    if (!shown.length) {
      this.#grid = null;
      if (this.#loading) {
        container.replaceChildren();
        return;
      }
      container.replaceChildren(emptyNote(this.#channels.length ? "No channels match the filter." : "No channels loaded."));
      return;
    }

    container.replaceChildren(this.#buildGuideGrid(shown));
    this.#renderSlice();
    this.#scrollToNow();
  }

  /**
   * TV guide table: channels in a sticky left column, programmes on a horizontal timeline.
   * The timeline runs from the last full hour before (now - 1h) to (now + GUIDE_HOURS_AHEAD).
   * Rows have a fixed height, so the body is as tall as all channels but holds only the rows in view
   * (#renderSlice): big playlists stay fast on weak car and phone CPUs.
   */
  #buildGuideGrid(channels) {
    const now = Date.now();
    const from = startOfHour(now - HOUR_MS);
    const to = now + GUIDE_HOURS_AHEAD * HOUR_MS;
    const toX = (ms) => ((Math.min(Math.max(ms, from), to) - from) / HOUR_MS) * PX_PER_HOUR;
    this.#windowFrom = from;

    const scroller = document.createElement("div");
    scroller.className = "epg";
    scroller.dataset.role = "scroller";
    scroller.style.setProperty("--epg-track-width", `${toX(to)}px`);

    let ticks = "";
    for (let hour = from; hour < to; hour += HALF_HOUR_MS) {
      const half = (hour - from) % HOUR_MS ? " epg__tick--half" : "";
      ticks += `<span class="epg__tick${half}" style="inset-inline-start:${toX(hour)}px">${formatClock(hour)}</span>`;
    }
    scroller.innerHTML = `
      <div class="epg__row epg__row--header">
        <div class="epg__corner">Now ${formatClock(now)}</div>
        <div class="epg__track epg__timeline">${ticks}</div>
      </div>
      <div class="epg__body">
        <div class="epg__rows" data-role="rows"></div>
        <span class="epg__now" style="--epg-now:${toX(now)}px"></span>
      </div>`;

    this.#grid = { channels, from, to, toX, scroller, rowHeight: 0 };
    this.#sliceRange = "";
    scroller.addEventListener("scroll", () => {
      if (this.#sliceFrame) return;
      this.#sliceFrame = requestAnimationFrame(() => {
        this.#sliceFrame = 0;
        this.#renderSlice();
      });
    }, { passive: true });
    // The table is built while the tab may be hidden (size 0); it fills in once it gets a size, and on resizes.
    this.#sizeObserver?.disconnect();
    this.#sizeObserver = new ResizeObserver(() => {
      this.#sliceRange = "";
      this.#renderSlice();
    });
    this.#sizeObserver.observe(scroller);
    return scroller;
  }

  /** Puts only the rows in view (plus OVERSCAN_ROWS) into the DOM, as one HTML string. */
  #renderSlice() {
    const grid = this.#grid;
    if (!grid?.scroller.isConnected) return;
    const { channels, scroller } = grid;
    const body = scroller.querySelector(".epg__body");
    const rowsBox = scroller.querySelector('[data-role="rows"]');
    if (!grid.rowHeight) {
      const rem = parseFloat(getComputedStyle(scroller).getPropertyValue("--epg-row-height")) || 4.25;
      grid.rowHeight = rem * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    }
    const rowHeight = grid.rowHeight;
    body.style.blockSize = `${channels.length * rowHeight}px`;

    const headerHeight = scroller.querySelector(".epg__row--header")?.offsetHeight || 0;
    const top = Math.max(0, scroller.scrollTop - headerHeight);
    const viewHeight = scroller.clientHeight || window.innerHeight;
    const visibleFirst = Math.floor(top / rowHeight);
    const visibleLast = Math.min(channels.length, Math.ceil((top + viewHeight) / rowHeight));
    // Rebuild only when the rows in view leave the rendered range, not on every row scrolled past.
    const [renderedFirst, renderedLast] = this.#sliceRange ? this.#sliceRange.split("-").map(Number) : [-1, -1];
    if (renderedFirst >= 0 && visibleFirst >= renderedFirst && visibleLast <= renderedLast) return;
    const first = Math.max(0, visibleFirst - OVERSCAN_ROWS);
    const last = Math.min(channels.length, visibleLast + OVERSCAN_ROWS);
    this.#sliceRange = `${first}-${last}`;

    const now = Date.now();
    rowsBox.style.paddingBlockStart = `${first * rowHeight}px`;
    rowsBox.innerHTML = channels.slice(first, last).map((channel) => this.#rowHtml(channel, now)).join("");
    // Rows are replaced on scroll, so the now line and live states come from the clock, not from older markup.
    this.#tick();
  }

  #rowHtml(channel, now) {
    const { from, to, toX } = this.#grid;
    const favorite = this.#isFavorite(channel);
    const current = this.#currentProgramme(channel.id, now);
    const logo = /^https?:\/\//i.test(channel.logo || "")
      ? `<img src="${escapeHtml(channel.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : escapeHtml(initials(channel.name));
    const programmes = (this.#guide.get(channel.id) || []).filter((entry) => entry.stop > from && entry.start < to);
    const blocks = programmes.length
      ? programmes.map((programme) => {
        const state = programme.stop <= now ? " is-past" : programme.start <= now ? " is-live" : "";
        const left = toX(programme.start);
        const width = Math.max(toX(programme.stop) - left, 2);
        const time = `${formatClock(programme.start)} - ${formatClock(programme.stop)}`;
        const tooltip = [`${time}  ${programme.title}`, programme.desc].filter(Boolean).join("\n\n");
        return `<button type="button" class="epg__programme${state}" data-start="${programme.start}" data-stop="${programme.stop}"
          data-channel-id="${escapeHtml(channel.id)}" style="inset-inline-start:${left}px;inline-size:${width}px" title="${escapeHtml(tooltip)}"><span
          class="epg__programme-label"><span class="epg__programme-title">${escapeHtml(programme.title)}</span><span
          class="epg__programme-time">${time}</span></span></button>`;
      }).join("")
      : `<span class="epg__none">${this.#guideLoading ? "Loading program guide..." : "No program guide"}</span>`;
    const name = escapeHtml(channel.name);
    return `<div class="epg__row"><div class="epg__channel">
        <button class="epg__channel-play" type="button" data-channel-id="${escapeHtml(channel.id)}" title="Watch ${name}">
          <span class="epg__logo" data-initials="${escapeHtml(initials(channel.name))}">${logo}</span>
          <span class="epg__channel-text"><span class="epg__channel-name">${name}</span><span
            class="epg__channel-now">${escapeHtml(current?.title || "")}</span></span>
        </button>
        <button class="icon-btn icon-btn--compact epg__favorite${favorite ? " is-active" : ""}" type="button"
          data-favorite-key="${escapeHtml(channelFavoriteKey(channel))}" aria-pressed="${favorite}"
          aria-label="${favorite ? "Remove from" : "Add to"} favorites: ${name}"><span
          class="icon icon--sm icon-mask ${favorite ? "icon-mask--heart" : "icon-mask--heart-outline"}" aria-hidden="true"></span></button>
      </div><div class="epg__track">${blocks}</div></div>`;
  }

  #isFavorite(channel) {
    return this.#favorites.has(channelFavoriteKey(channel));
  }

  /** Starts the timeline half an hour before now, so the current programmes are in view. */
  #scrollToNow() {
    const scroller = this.querySelector('[data-role="scroller"]');
    const nowLine = scroller?.querySelector(".epg__now");
    if (!scroller || !nowLine) return;
    const nowX = parseFloat(nowLine.style.getPropertyValue("--epg-now")) || 0;
    scroller.scrollLeft = Math.max(0, nowX - PX_PER_HOUR / 2);
  }

  #currentProgramme(channelId, now) {
    return (this.#guide.get(channelId) || []).find((entry) => entry.start <= now && entry.stop > now) || null;
  }
}

function initials(name) {
  return String(name || "?").replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emptyNote(text) {
  const note = document.createElement("p");
  note.className = "text-empty-state";
  note.textContent = text;
  return note;
}

function startOfHour(ms) {
  const date = new Date(ms);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

// One shared formatter: toLocaleTimeString per programme block was a large part of the render time.
const CLOCK_FORMAT = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });

function formatClock(ms) {
  return CLOCK_FORMAT.format(ms);
}

customElements.define("carplayer-iptv", CarplayerIptv);
