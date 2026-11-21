/**
 * <carplayer-iptv> - IPTV tab: playlist setup card, channel list with "now playing" and a channel guide panel.
 *
 * Methods: setConfig(config), setChannels({channels, status}), setGuide(guide), setStatus(text, isError)
 * Events: 'save-config' {playlistUrl, epgUrl, corsProxy}, 'load-sample', 'reload', 'edit-config',
 *         'play-channel' {channelId}
 */
const MAX_VISIBLE_CHANNELS = 400;

export default class CarplayerIptv extends HTMLElement {
  #rendered = false;
  #configured = false;
  #channels = [];
  #guide = new Map();
  #group = "";
  #query = "";
  #selectedId = "";
  #clockTimer = null;

  connectedCallback() {
    if (this.#rendered) return;
    this.#rendered = true;

    this.innerHTML = `
      <div class="tab-view">
        <div class="tab-view__setup hidden" data-role="setup">
          <carplayer-setup-card heading="Set up IPTV"
            note="Add an M3U playlist link. The program guide (EPG, XMLTV format, .xml or .xml.gz) is optional. Streams must be HLS (.m3u8) and served over HTTPS with CORS."
            phone-step='Paste the playlist and EPG links and tap "Send to Car".'>
            <label class="field-label">Playlist (M3U)
              <carplayer-clearable-input data-field="playlistUrl" type="url" placeholder="https://provider.example/playlist.m3u" class="field field--url"></carplayer-clearable-input>
            </label>
            <label class="field-label">Program guide (EPG, optional)
              <carplayer-clearable-input data-field="epgUrl" type="url" placeholder="https://provider.example/epg.xml.gz" class="field field--url"></carplayer-clearable-input>
            </label>
            <details class="setup-advanced">
              <summary>Advanced: CORS proxy</summary>
              <p class="section-note">Used for the playlist and the EPG when their server does not allow CORS. Use {url} where the encoded address goes, or the address is appended at the end.</p>
              <carplayer-clearable-input data-field="corsProxy" type="text" placeholder="https://proxy.example/?url={url}" class="field field--url"></carplayer-clearable-input>
            </details>
            <div class="button-row">
              <button class="btn btn--primary" data-action="save" type="button">Save IPTV</button>
              <button class="btn btn--ghost" data-action="sample" type="button">Load sample</button>
              <button class="btn btn--ghost hidden" data-action="cancel" type="button">Cancel</button>
            </div>
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
          <div class="iptv-layout">
            <ul class="channel-list" data-role="list"></ul>
            <aside class="guide-panel hidden" data-role="guide"></aside>
          </div>
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

  setChannels(channels) {
    this.#channels = channels;
    this.#group = "";
    this.#selectedId = "";
    this.#renderGroups();
    this.#renderList();
    this.#renderGuide();
  }

  setGuide(guide) {
    this.#guide = guide;
    this.#renderList();
    this.#renderGuide();
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
    this.querySelector('[data-action="sample"]').addEventListener("click", () => this.dispatchEvent(new CustomEvent("load-sample")));
    this.querySelector('[data-action="cancel"]').addEventListener("click", () => this.#showSetup(false));
    this.querySelector('[data-action="reload"]').addEventListener("click", () => this.dispatchEvent(new CustomEvent("reload")));
    this.querySelector('[data-action="edit"]').addEventListener("click", () => this.#showSetup(true));

    this.querySelector('[data-role="filter"]').addEventListener("input", (event) => {
      this.#query = event.target.value.trim().toLowerCase();
      this.#renderList();
    });

    this.querySelector('[data-role="groups"]').addEventListener("click", (event) => {
      const chip = event.target.closest("[data-group]");
      if (!chip) return;
      this.#group = chip.dataset.group;
      this.#renderGroups();
      this.#renderList();
    });

    this.querySelector('[data-role="list"]').addEventListener("click", (event) => {
      const row = event.target.closest("[data-channel-id]");
      if (!row) return;
      if (event.target.closest('[data-action="play"]')) {
        this.#emitPlay(row.dataset.channelId);
        return;
      }
      this.#selectedId = row.dataset.channelId;
      this.#renderList();
      this.#renderGuide();
    });

    this.querySelector('[data-role="guide"]').addEventListener("click", (event) => {
      if (event.target.closest('[data-action="play-selected"]')) this.#emitPlay(this.#selectedId);
      if (event.target.closest('[data-action="close-guide"]')) {
        this.#selectedId = "";
        this.#renderList();
        this.#renderGuide();
      }
    });

    // Keep "now playing" and progress bars current.
    this.#clockTimer = setInterval(() => {
      if (!this.isConnected || this.closest(".hidden") || !this.#guide.size) return;
      this.#renderList();
      this.#renderGuide();
    }, 60000);
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
    container.replaceChildren(...["", ...groups].map((group) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `chip${group === this.#group ? " is-active" : ""}`;
      chip.dataset.group = group;
      chip.textContent = group || `All (${this.#channels.length})`;
      return chip;
    }));
    container.classList.toggle("hidden", groups.length < 2);
  }

  #renderList() {
    const list = this.querySelector('[data-role="list"]');
    const now = Date.now();
    const visible = this.#channels.filter((channel) => {
      if (this.#group && channel.group !== this.#group) return false;
      return !this.#query || channel.name.toLowerCase().includes(this.#query);
    });

    const rows = visible.slice(0, MAX_VISIBLE_CHANNELS).map((channel) => {
      const current = this.#currentProgramme(channel.id, now);
      const row = document.createElement("li");
      row.className = `channel-row${channel.id === this.#selectedId ? " is-selected" : ""}`;
      row.dataset.channelId = channel.id;
      row.innerHTML = `
        <span class="channel-row__logo"></span>
        <span class="channel-row__text">
          <span class="channel-row__name"></span>
          <span class="channel-row__now"></span>
          <span class="channel-row__progress"><span class="channel-row__progress-fill"></span></span>
        </span>
        <button class="icon-btn icon-btn--compact channel-row__play" data-action="play" type="button" aria-label="Play">
          <span class="icon icon--sm icon-mask icon-mask--play" aria-hidden="true"></span>
        </button>
      `;
      this.#setLogo(row.querySelector(".channel-row__logo"), channel);
      row.querySelector(".channel-row__name").textContent = channel.name;
      row.querySelector(".channel-row__now").textContent = current ? `${formatClock(current.start)} ${current.title}` : (channel.group || "");
      const progress = row.querySelector(".channel-row__progress");
      progress.classList.toggle("hidden", !current);
      if (current) {
        const percent = Math.min(100, Math.max(0, ((now - current.start) / (current.stop - current.start)) * 100));
        row.querySelector(".channel-row__progress-fill").style.width = `${percent}%`;
      }
      return row;
    });

    list.replaceChildren(...rows);
    if (!rows.length) {
      const empty = document.createElement("li");
      empty.className = "text-empty-state";
      empty.textContent = this.#channels.length ? "No channels match the filter." : "No channels loaded.";
      list.appendChild(empty);
    } else if (visible.length > MAX_VISIBLE_CHANNELS) {
      const more = document.createElement("li");
      more.className = "text-empty-state";
      more.textContent = `Showing ${MAX_VISIBLE_CHANNELS} of ${visible.length} channels. Use the filter to narrow the list.`;
      list.appendChild(more);
    }
  }

  #renderGuide() {
    const panel = this.querySelector('[data-role="guide"]');
    const channel = this.#channels.find((entry) => entry.id === this.#selectedId);
    panel.classList.toggle("hidden", !channel);
    this.querySelector(".iptv-layout").classList.toggle("has-guide", Boolean(channel));
    if (!channel) return;

    const now = Date.now();
    const programmes = (this.#guide.get(channel.id) || []).filter((entry) => entry.stop > now).slice(0, 30);

    panel.innerHTML = `
      <header class="guide-panel__header">
        <span class="channel-row__logo"></span>
        <h3 class="guide-panel__title"></h3>
        <button class="icon-btn icon-btn--compact" data-action="close-guide" type="button" aria-label="Close guide">
          <span class="icon icon--sm icon-mask icon-mask--close" aria-hidden="true"></span>
        </button>
      </header>
      <button class="btn btn--primary btn--block" data-action="play-selected" type="button">
        <span class="icon icon--sm icon-mask icon-mask--play" aria-hidden="true"></span> Watch live
      </button>
      <ol class="guide-list"></ol>
    `;
    this.#setLogo(panel.querySelector(".channel-row__logo"), channel);
    panel.querySelector(".guide-panel__title").textContent = channel.name;

    const list = panel.querySelector(".guide-list");
    if (!programmes.length) {
      const empty = document.createElement("li");
      empty.className = "text-empty-state";
      empty.textContent = this.#guide.size ? "No program guide for this channel." : "Program guide not loaded.";
      list.appendChild(empty);
      return;
    }
    programmes.forEach((programme) => {
      const item = document.createElement("li");
      item.className = `guide-item${programme.start <= now ? " is-live" : ""}`;
      item.innerHTML = '<span class="guide-item__time"></span><span class="guide-item__body"><span class="guide-item__title"></span><span class="guide-item__desc"></span></span>';
      item.querySelector(".guide-item__time").textContent = `${formatClock(programme.start)} - ${formatClock(programme.stop)}`;
      item.querySelector(".guide-item__title").textContent = programme.title;
      item.querySelector(".guide-item__desc").textContent = programme.desc;
      list.appendChild(item);
    });
  }

  #currentProgramme(channelId, now) {
    return (this.#guide.get(channelId) || []).find((entry) => entry.start <= now && entry.stop > now) || null;
  }

  #setLogo(element, channel) {
    if (channel.logo) {
      const img = document.createElement("img");
      img.src = channel.logo;
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

function formatClock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

customElements.define("carplayer-iptv", CarplayerIptv);
