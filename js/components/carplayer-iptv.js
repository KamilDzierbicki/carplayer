import { channelFavoriteKey } from "../iptv-parsers.js";

/**
 * <carplayer-iptv> - IPTV tab: playlist setup card and a TV guide table (channels left, programme timeline right).
 * Channels without a program guide get an empty timeline row. Favorite channels are listed first and have their own chip.
 *
 * Methods: setConfig(config), setChannels({channels, status}), setGuide(guide), setStatus(text, isError)
 * Events: 'save-config' {playlistUrl, epgUrl, corsProxy}, 'reload', 'edit-config',
 *         'play-channel' {channelId}
 */
const MAX_VISIBLE_CHANNELS = 400;
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
  #logoObserver = null;

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
    const visible = [...matching.filter((channel) => this.#isFavorite(channel)), ...matching.filter((channel) => !this.#isFavorite(channel))];
    const shown = visible.slice(0, MAX_VISIBLE_CHANNELS);

    if (!shown.length) {
      if (this.#loading) {
        container.replaceChildren();
        return;
      }
      container.replaceChildren(emptyNote(this.#channels.length ? "No channels match the filter." : "No channels loaded."));
      return;
    }

    container.replaceChildren(this.#buildGuideGrid(shown));
    if (visible.length > shown.length) {
      container.appendChild(emptyNote(`Showing ${shown.length} of ${visible.length} channels. Use the filter to narrow the list.`));
    }
    this.#scrollToNow();
  }

  /**
   * TV guide table: channels in a sticky left column, programmes on a horizontal timeline.
   * The timeline runs from the last full hour before (now - 1h) to (now + GUIDE_HOURS_AHEAD).
   */
  #buildGuideGrid(channels) {
    const now = Date.now();
    const from = startOfHour(now - HOUR_MS);
    const to = now + GUIDE_HOURS_AHEAD * HOUR_MS;
    const toX = (ms) => ((Math.min(Math.max(ms, from), to) - from) / HOUR_MS) * PX_PER_HOUR;

    this.#windowFrom = from;
    const scroller = document.createElement("div");
    // Channel logos load only when their row comes near the visible part of the table.
    this.#logoObserver?.disconnect();
    this.#logoObserver = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.src = entry.target.dataset.src;
        this.#logoObserver.unobserve(entry.target);
      });
    }, { root: scroller, rootMargin: "200px" }) : null;
    scroller.className = "epg";
    scroller.dataset.role = "scroller";
    scroller.style.setProperty("--epg-track-width", `${toX(to)}px`);

    const header = document.createElement("div");
    header.className = "epg__row epg__row--header";
    header.innerHTML = '<div class="epg__corner"></div><div class="epg__track epg__timeline"></div>';
    header.querySelector(".epg__corner").textContent = `Now ${formatClock(now)}`;
    const timeline = header.querySelector(".epg__timeline");
    for (let hour = from; hour < to; hour += HALF_HOUR_MS) {
      const tick = document.createElement("span");
      tick.className = `epg__tick${(hour - from) % HOUR_MS ? " epg__tick--half" : ""}`;
      tick.style.insetInlineStart = `${toX(hour)}px`;
      tick.textContent = formatClock(hour);
      timeline.appendChild(tick);
    }

    const rows = channels.map((channel) => {
      const row = document.createElement("div");
      row.className = "epg__row";
      const current = this.#currentProgramme(channel.id, now);
      row.appendChild(this.#buildChannelCell(channel, current?.title || ""));

      const track = document.createElement("div");
      track.className = "epg__track";
      const programmes = (this.#guide.get(channel.id) || []).filter((entry) => entry.stop > from && entry.start < to);
      if (!programmes.length) {
        const none = document.createElement("span");
        none.className = "epg__none";
        none.textContent = this.#guideLoading ? "Loading program guide..." : "No program guide";
        track.appendChild(none);
      }
      programmes.forEach((programme) => {
        const block = document.createElement("button");
        block.type = "button";
        const state = programme.stop <= now ? " is-past" : programme.start <= now ? " is-live" : "";
        block.className = `epg__programme${state}`;
        block.dataset.start = String(programme.start);
        block.dataset.stop = String(programme.stop);
        block.dataset.channelId = channel.id;
        block.style.insetInlineStart = `${toX(programme.start)}px`;
        block.style.inlineSize = `${Math.max(toX(programme.stop) - toX(programme.start), 2)}px`;
        block.title = [`${formatClock(programme.start)} - ${formatClock(programme.stop)}  ${programme.title}`, programme.desc].filter(Boolean).join("\n\n");
        block.innerHTML = '<span class="epg__programme-label"><span class="epg__programme-title"></span><span class="epg__programme-time"></span></span>';
        block.querySelector(".epg__programme-title").textContent = programme.title;
        block.querySelector(".epg__programme-time").textContent = `${formatClock(programme.start)} - ${formatClock(programme.stop)}`;
        track.appendChild(block);
      });
      row.appendChild(track);
      return row;
    });

    const body = document.createElement("div");
    body.className = "epg__body";
    const nowLine = document.createElement("span");
    nowLine.className = "epg__now";
    nowLine.style.setProperty("--epg-now", `${toX(now)}px`);
    body.append(...rows, nowLine);

    scroller.append(header, body);
    return scroller;
  }

  #buildChannelCell(channel, subtitle) {
    const favorite = this.#isFavorite(channel);
    const cell = document.createElement("div");
    cell.className = "epg__channel";
    cell.innerHTML = `
      <button class="epg__channel-play" type="button" data-channel-id="">
        <span class="epg__logo"></span>
        <span class="epg__channel-text">
          <span class="epg__channel-name"></span>
          <span class="epg__channel-now"></span>
        </span>
      </button>
      <button class="icon-btn icon-btn--compact epg__favorite${favorite ? " is-active" : ""}" type="button" data-favorite-key=""
        aria-pressed="${favorite}">
        <span class="icon icon--sm icon-mask ${favorite ? "icon-mask--heart" : "icon-mask--heart-outline"}" aria-hidden="true"></span>
      </button>
    `;
    const play = cell.querySelector(".epg__channel-play");
    play.dataset.channelId = channel.id;
    play.title = `Watch ${channel.name}`;
    const favoriteButton = cell.querySelector(".epg__favorite");
    favoriteButton.dataset.favoriteKey = channelFavoriteKey(channel);
    favoriteButton.setAttribute("aria-label", `${favorite ? "Remove from" : "Add to"} favorites: ${channel.name}`);
    this.#setLogo(cell.querySelector(".epg__logo"), channel);
    cell.querySelector(".epg__channel-name").textContent = channel.name;
    cell.querySelector(".epg__channel-now").textContent = subtitle;
    return cell;
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

  #setLogo(element, channel) {
    if (channel.logo) {
      const img = document.createElement("img");
      if (this.#logoObserver) {
        img.dataset.src = channel.logo;
        this.#logoObserver.observe(img);
      } else {
        img.src = channel.logo;
      }
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        element.textContent = initials(channel.name);
      }, { once: true });
      element.replaceChildren(img);
    } else {
      element.textContent = initials(channel.name);
    }
  }
}

function initials(name) {
  return String(name || "?").replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
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
