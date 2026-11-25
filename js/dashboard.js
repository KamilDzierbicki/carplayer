import { WIDGETS } from "./dashboard-widgets.js";

const SIZE_LABELS = { l: "L", m: "M", s: "S" };
const LONG_PRESS_MS = 500;
// Widgets in one row whose content heights differ by at most this much get the same height.
const EQUAL_HEIGHT_PX = 80;

/**
 * Dashboard tab: widget grid (enable, size, order stored in localStorage) and the widget manager modal.
 * Size and remove buttons and dragging by the top edge exist only in edit mode ("Edit widgets" until "Done"),
 * so a widget never moves or disappears from a stray tap while driving. Widgets are mounted only while the tab is visible, so GPS and timers stop
 * when the user leaves the dashboard.
 */
export default class DashboardController {
  #app;
  #storage;
  #share;
  #ctx;
  #grid;
  #manager;
  #cleanups = [];
  #visible = false;
  // Watches each widget body: its height is the content's own, unlike the card, whose height #fitRows sets.
  #rowObserver = new ResizeObserver(() => this.#fitRows());
  #editing = false;

  constructor({ app, storage, share, jellyfinService }) {
    this.#app = app;
    this.#storage = storage;
    this.#share = share;
    this.#grid = document.getElementById("dashboardGrid");
    this.#manager = document.getElementById("widgetManager");
    this.#ctx = {
      storage,
      jellyfin: jellyfinService,
      playJellyfin: (itemId, title, serverBaseUrl) => jellyfinService.load(itemId, title, serverBaseUrl),
      playIptvFavorite: () => {},
      playRadioFavorite: () => {},
      playVideoFavorite: () => {},
    };

    document.getElementById("btnEditWidgets")?.addEventListener("click", () => this.#setEditing(true));
    document.getElementById("btnWidgetsDone")?.addEventListener("click", () => this.#setEditing(false));
    document.getElementById("btnAddWidget")?.addEventListener("click", () => {
      this.#renderManager();
      this.#app.openModal("widgetsModal");
    });
    this.#manager?.addEventListener("click", (event) => this.#handleManagerClick(event));
    this.#grid?.addEventListener("click", (event) => this.#handleWidgetClick(event));
    document.addEventListener("tab-change", (event) => this.#setVisible(event.detail.tab === "dashboard"));
    this.#bindDragging();
    this.#bindLongPress();
  }

  /** IPTV and radio controllers are created after the dashboard, so the Favorites widget gets them here. */
  setFavoritePlayers({ iptv, radio, playVideo }) {
    this.#ctx.playIptvFavorite = (key) => iptv.playFavorite(key);
    this.#ctx.playRadioFavorite = (stationId) => radio.playFavorite(stationId);
    this.#ctx.playVideoFavorite = (id) => {
      const entry = this.#storage.getVideoFavorites().find((item) => item.id === id);
      if (entry) void playVideo(entry);
    };
  }

  #setVisible(visible) {
    // A phone opened from a car QR code only needs its send form, not widgets asking for GPS.
    if (visible && this.#share.isPhoneRelayMode()) return;
    if (visible === this.#visible) return;
    this.#visible = visible;
    if (!visible) this.#setEditing(false);
    if (visible) this.#render();
    else this.#unmountAll();
  }

  #setEditing(editing) {
    this.#editing = editing;
    this.#grid?.classList.toggle("is-editing", editing);
    document.getElementById("btnEditWidgets")?.classList.toggle("hidden", editing);
    document.getElementById("dashboardEditActions")?.classList.toggle("hidden", !editing);
  }

  /**
   * Stored layout merged with widget defaults, so widgets added in later versions appear too.
   * Entry: { id, type, enabled, size, settings }. One entry per widget type, plus extra copies
   * (id "<type>~<suffix>") for widgets marked multiple, such as one weather widget per city.
   */
  #getLayout() {
    const stored = Array.isArray(this.#storage.getWidgetLayout()) ? this.#storage.getWidgetLayout() : [];
    const layout = stored
      .map((entry) => ({ ...entry, type: entry.type || entry.id }))
      .filter((entry) => this.#widgetFor(entry))
      .map((entry) => {
        const widget = this.#widgetFor(entry);
        return {
          id: entry.id,
          type: entry.type,
          enabled: Boolean(entry.enabled),
          size: widget.sizes.includes(entry.size) ? entry.size : widget.defaultSize,
          settings: entry.settings || {},
        };
      });
    WIDGETS.forEach((widget, index) => {
      if (layout.some((entry) => entry.id === widget.id)) return;
      // A widget added in a later version lands right after its neighbour in WIDGETS (e.g. G-Force after GPS Speed).
      const previousId = WIDGETS[index - 1]?.id;
      const previousIndex = layout.findIndex((entry) => entry.id === previousId);
      const entry = { id: widget.id, type: widget.id, enabled: widget.defaultEnabled, size: widget.defaultSize, settings: {} };
      layout.splice(previousIndex >= 0 ? previousIndex + 1 : layout.length, 0, entry);
    });
    return layout;
  }

  #widgetFor(entry) {
    return WIDGETS.find((widget) => widget.id === entry.type) || null;
  }

  #saveLayout(layout) {
    this.#storage.saveWidgetLayout(layout);
    if (this.#visible) this.#render();
  }

  #saveSettings(entryId, settings) {
    const layout = this.#getLayout();
    const entry = layout.find((item) => item.id === entryId);
    if (!entry) return;
    entry.settings = settings;
    this.#saveLayout(layout);
    if (this.#manager?.closest(".modal.active")) this.#renderManager();
  }

  #render() {
    if (!this.#grid) return;
    // Rebuilding the grid shrinks the page for a moment, which would scroll it up; the position is put back below.
    const scroller = document.getElementById("setupScreen");
    const scrollTop = scroller?.scrollTop ?? 0;
    this.#unmountAll();

    const enabled = this.#getLayout().filter((entry) => entry.enabled);
    const cards = enabled.map((entry) => {
      const widget = this.#widgetFor(entry);
      const card = document.createElement("article");
      card.className = `widget widget--${entry.size}`;
      card.dataset.widgetId = entry.id;
      card.innerHTML = `
        <header class="widget__header" data-role="drag-handle">
          <span class="icon icon--sm icon-mask icon-mask--drag widget__grip" aria-hidden="true"></span>
          <h3 class="widget__title"></h3>
          <span class="widget__actions">
            ${sizePicker(widget, entry)}
            <button type="button" class="widget__remove" data-remove aria-label="Remove ${escapeHtml(widget.title)} widget">
              <span class="icon icon--sm icon-mask icon-mask--close" aria-hidden="true"></span>
            </button>
          </span>
        </header>
        <div class="widget__body"></div>
      `;
      card.querySelector(".widget__title").textContent = widget.title;
      const ctx = {
        ...this.#ctx,
        settings: entry.settings,
        saveSettings: (settings) => this.#saveSettings(entry.id, settings),
      };
      try {
        this.#cleanups.push(widget.mount(card.querySelector(".widget__body"), ctx, entry.size) || (() => {}));
      } catch (error) {
        console.error(`[Dashboard] widget ${entry.id} failed`, error);
        card.querySelector(".widget__body").textContent = "This widget failed to load.";
      }
      return card;
    });

    this.#grid.replaceChildren(...cards);
    // Rows are fitted now, not on the observer's first callback, so the grid has its full height before restoring.
    this.#fitRows();
    cards.forEach((card) => this.#rowObserver.observe(card.querySelector(".widget__body")));
    if (scroller) scroller.scrollTop = scrollTop;
    if (!cards.length) {
      const empty = document.createElement("div");
      empty.className = "text-empty-state";
      empty.textContent = "No widgets on the dashboard. Tap Edit widgets, then Add widget.";
      this.#grid.appendChild(empty);
    }
  }

  /**
   * Sets each widget's height and its span of 1px grid rows (see .widget-grid); the span adds the gap below it.
   * Every widget starts at its content height. Then, row by row, widgets of similar height (within
   * EQUAL_HEIGHT_PX of each other) get the tallest one's height, so their edges line up, while a much taller
   * neighbour such as G-Force leaves the short ones alone and the space under them free for the next widget.
   */
  #fitRows() {
    const cards = [...this.#grid.querySelectorAll(".widget")];
    if (!cards.length) return;
    const gap = parseFloat(getComputedStyle(this.#grid).columnGap) || 0;
    const natural = new Map(cards.map((card) => [
      card,
      card.querySelector(".widget__header").offsetHeight + card.querySelector(".widget__body").offsetHeight,
    ]));
    const setHeight = (card, height) => {
      card.style.blockSize = `${Math.ceil(height)}px`;
      card.style.gridRowEnd = `span ${Math.ceil(height + gap)}`;
    };
    cards.forEach((card) => setHeight(card, natural.get(card)));

    // Rows top to bottom; tops are read again after each row, because a taller row moves everything below it.
    const pending = new Set(cards);
    while (pending.size) {
      const top = Math.min(...[...pending].map((card) => card.offsetTop));
      const row = [...pending].filter((card) => Math.abs(card.offsetTop - top) < 2)
        .sort((a, b) => natural.get(a) - natural.get(b));
      let group = [];
      const flush = () => {
        const height = Math.max(...group.map((card) => natural.get(card)));
        group.forEach((card) => setHeight(card, height));
        group = [];
      };
      row.forEach((card) => {
        if (group.length && natural.get(card) - natural.get(group[group.length - 1]) > EQUAL_HEIGHT_PX) flush();
        group.push(card);
      });
      flush();
      row.forEach((card) => pending.delete(card));
    }
  }

  #unmountAll() {
    this.#rowObserver.disconnect();
    this.#cleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch (error) {
        console.warn("[Dashboard] widget cleanup failed", error);
      }
    });
    this.#cleanups = [];
  }

  #renderManager() {
    if (!this.#manager) return;
    const layout = this.#getLayout();
    const groups = [
      { id: "interactive", title: "Interactive widgets" },
      { id: "jellyfin", title: "Jellyfin widgets" },
    ];

    const row = (widget, entry) => {
      const name = widget.label ? `${widget.title} · ${widget.label(entry.settings)}` : widget.title;
      const isCopy = entry.id !== widget.id;
      return `
        <div class="widget-manager__row" data-widget-id="${escapeHtml(entry.id)}">
          <span class="widget-manager__name">${escapeHtml(name)}</span>
          ${sizePicker(widget, entry)}
          ${isCopy
            ? `<button type="button" class="icon-btn icon-btn--compact" data-remove aria-label="Remove ${escapeHtml(name)}">
                 <span class="icon icon--sm icon-mask icon-mask--trash" aria-hidden="true"></span></button>`
            : `<button type="button" class="switch${entry.enabled ? " is-on" : ""}" data-toggle role="switch"
                 aria-checked="${entry.enabled}" aria-label="Show ${escapeHtml(name)}"><span class="switch__thumb"></span></button>`}
        </div>`;
    };

    this.#manager.innerHTML = `
      <p class="section-note">Turn widgets on and pick their size. To reorder them, drag a widget by its top edge on the dashboard.</p>
      <div class="widget-manager__columns">
        ${groups.map((group) => `
          <section class="widget-manager__group">
            <h3 class="widget-manager__title">${group.title}</h3>
            ${WIDGETS.filter((widget) => widget.group === group.id).map((widget) => `
              ${layout.filter((entry) => entry.type === widget.id).map((entry) => row(widget, entry)).join("")}
              ${widget.multiple ? `
                <button type="button" class="btn btn--dark btn--compact widget-manager__add" data-add="${widget.id}">
                  <span class="icon icon--sm icon-mask icon-mask--plus" aria-hidden="true"></span>
                  Add ${widget.title.toLowerCase()} widget
                </button>` : ""}
            `).join("")}
          </section>`).join("")}
      </div>
    `;
  }

  #handleManagerClick(event) {
    const addType = event.target.closest("[data-add]")?.dataset.add;
    if (addType) {
      const widget = WIDGETS.find((item) => item.id === addType);
      const layout = this.#getLayout();
      layout.push({
        id: `${widget.id}~${Date.now().toString(36)}`,
        type: widget.id,
        enabled: true,
        size: widget.defaultSize,
        settings: widget.newSettings ? widget.newSettings() : {},
      });
      this.#saveLayout(layout);
      this.#renderManager();
      return;
    }

    const row = event.target.closest("[data-widget-id]");
    if (row && this.#applyWidgetAction(row.dataset.widgetId, event.target)) this.#renderManager();
  }

  /** Size and remove buttons in a widget's own header. */
  #handleWidgetClick(event) {
    const card = event.target.closest(".widget");
    if (card) this.#applyWidgetAction(card.dataset.widgetId, event.target);
  }

  /**
   * Applies the size, remove or toggle button under `target` to one layout entry. Removing an extra copy
   * deletes it with its settings; removing a built-in widget only hides it, so Edit widgets can bring it back.
   * Returns true when the layout changed.
   */
  #applyWidgetAction(entryId, target) {
    let layout = this.#getLayout();
    const entry = layout.find((item) => item.id === entryId);
    if (!entry) return false;

    if (target.closest("[data-remove]")) {
      const isCopy = entry.id !== entry.type;
      if (isCopy) layout = layout.filter((item) => item.id !== entry.id);
      else entry.enabled = false;
    } else if (target.closest("[data-toggle]")) {
      entry.enabled = !entry.enabled;
    } else {
      const size = target.closest("[data-size]")?.dataset.size;
      if (!size || size === entry.size) return false;
      entry.size = size;
    }
    this.#saveLayout(layout);
    return true;
  }

  /** Holding a widget for half a second opens edit mode, like a phone home screen. */
  #bindLongPress() {
    if (!this.#grid) return;
    let timer = 0;
    let start = null;
    let swallowClick = false;
    const cancel = () => {
      clearTimeout(timer);
      timer = 0;
    };

    this.#grid.addEventListener("pointerdown", (event) => {
      swallowClick = false;
      if (this.#editing || !event.target.closest(".widget") || event.target.closest("input, textarea, select")) return;
      start = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => {
        timer = 0;
        swallowClick = true;
        this.#setEditing(true);
      }, LONG_PRESS_MS);
    });
    // A scroll or swipe is not a hold.
    this.#grid.addEventListener("pointermove", (event) => {
      if (timer && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((type) => this.#grid.addEventListener(type, cancel));
    // The finger lifting after the hold must not also press the tile or button under it.
    this.#grid.addEventListener("click", (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    this.#grid.addEventListener("contextmenu", (event) => {
      if (this.#editing) event.preventDefault();
    });
  }

  #bindDragging() {
    if (!this.#grid) return;
    let dragged = null;

    this.#grid.addEventListener("pointerdown", (event) => {
      if (!this.#editing || !event.target.closest('[data-role="drag-handle"]') || event.target.closest("button")) return;
      dragged = event.target.closest(".widget");
      if (!dragged) return;
      event.preventDefault();
      dragged.classList.add("is-dragging");
      this.#grid.setPointerCapture(event.pointerId);
    });

    this.#grid.addEventListener("pointermove", (event) => {
      if (!dragged) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".widget");
      if (!target || target === dragged || target.parentElement !== this.#grid) return;
      const rect = target.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2
        || (event.clientY < rect.bottom && event.clientX < rect.left + rect.width / 2);
      this.#grid.insertBefore(dragged, before ? target : target.nextSibling);
    });

    const finish = () => {
      if (!dragged) return;
      dragged.classList.remove("is-dragging");
      dragged = null;
      const order = [...this.#grid.querySelectorAll(".widget")].map((card) => card.dataset.widgetId);
      const layout = this.#getLayout();
      layout.sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
      });
      // Save without re-rendering: the DOM already shows the new order, and re-mounting would restart widgets.
      this.#storage.saveWidgetLayout(layout);
    };
    this.#grid.addEventListener("pointerup", finish);
    this.#grid.addEventListener("pointercancel", finish);
  }
}

/** S/M/L buttons for a widget with more than one size; empty for single-size widgets. */
function sizePicker(widget, entry) {
  if (widget.sizes.length < 2) return "";
  const buttons = widget.sizes.map((size) => `
    <button type="button" class="size-picker__btn${entry.size === size ? " is-active" : ""}" data-size="${size}"
      aria-pressed="${entry.size === size}" aria-label="Size ${SIZE_LABELS[size]}"
      ${entry.enabled ? "" : "disabled"}>${SIZE_LABELS[size]}</button>`).join("");
  return `<span class="size-picker">${buttons}</span>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
