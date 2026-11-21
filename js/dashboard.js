import { WIDGETS } from "./dashboard-widgets.js";

const SIZE_LABELS = { l: "L", m: "M", s: "S" };

/**
 * Dashboard tab: widget grid (enable, size, order stored in localStorage), drag to reorder by the top edge,
 * and the widget manager modal. Widgets are mounted only while the tab is visible, so GPS and timers stop
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
    };

    document.getElementById("btnEditWidgets")?.addEventListener("click", () => {
      this.#renderManager();
      this.#app.openModal("widgetsModal");
    });
    this.#manager?.addEventListener("click", (event) => this.#handleManagerClick(event));
    document.addEventListener("tab-change", (event) => this.#setVisible(event.detail.tab === "dashboard"));
    this.#bindDragging();
  }

  #setVisible(visible) {
    // A phone opened from a car QR code only needs its send form, not widgets asking for GPS.
    if (visible && this.#share.isPhoneRelayMode()) return;
    if (visible === this.#visible) return;
    this.#visible = visible;
    if (visible) this.#render();
    else this.#unmountAll();
  }

  /** Stored layout merged with widget defaults, so widgets added in later versions appear too. */
  #getLayout() {
    const stored = Array.isArray(this.#storage.getWidgetLayout()) ? this.#storage.getWidgetLayout() : [];
    const layout = stored
      .filter((entry) => WIDGETS.some((widget) => widget.id === entry.id))
      .map((entry) => {
        const widget = WIDGETS.find((item) => item.id === entry.id);
        return { id: entry.id, enabled: Boolean(entry.enabled), size: widget.sizes.includes(entry.size) ? entry.size : widget.defaultSize };
      });
    WIDGETS.forEach((widget) => {
      if (!layout.some((entry) => entry.id === widget.id)) {
        layout.push({ id: widget.id, enabled: widget.defaultEnabled, size: widget.defaultSize });
      }
    });
    return layout;
  }

  #saveLayout(layout) {
    this.#storage.saveWidgetLayout(layout);
    if (this.#visible) this.#render();
  }

  #render() {
    if (!this.#grid) return;
    this.#unmountAll();

    const enabled = this.#getLayout().filter((entry) => entry.enabled);
    const cards = enabled.map((entry) => {
      const widget = WIDGETS.find((item) => item.id === entry.id);
      const card = document.createElement("article");
      card.className = `widget widget--${entry.size}`;
      card.dataset.widgetId = widget.id;
      card.innerHTML = `
        <header class="widget__header" data-role="drag-handle" title="Hold the top edge to drag">
          <span class="icon icon--sm icon-mask icon-mask--drag widget__grip" aria-hidden="true"></span>
          <h3 class="widget__title"></h3>
        </header>
        <div class="widget__body"></div>
      `;
      card.querySelector(".widget__title").textContent = widget.title;
      try {
        this.#cleanups.push(widget.mount(card.querySelector(".widget__body"), this.#ctx, entry.size) || (() => {}));
      } catch (error) {
        console.error(`[Dashboard] widget ${widget.id} failed`, error);
        card.querySelector(".widget__body").textContent = "This widget failed to load.";
      }
      return card;
    });

    this.#grid.replaceChildren(...cards);
    if (!cards.length) {
      const empty = document.createElement("div");
      empty.className = "text-empty-state";
      empty.textContent = "No widgets enabled. Use Edit widgets to add some.";
      this.#grid.appendChild(empty);
    }
  }

  #unmountAll() {
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

    this.#manager.innerHTML = `
      <p class="section-note">Turn widgets on and pick their size. On the dashboard, hold the top edge of a widget to drag it.</p>
      <div class="widget-manager__columns">
        ${groups.map((group) => `
          <section class="widget-manager__group">
            <h3 class="widget-manager__title">${group.title}</h3>
            ${WIDGETS.filter((widget) => widget.group === group.id).map((widget) => {
              const entry = layout.find((item) => item.id === widget.id);
              return `
                <div class="widget-manager__row" data-widget-id="${widget.id}">
                  <span class="widget-manager__name">${widget.title}</span>
                  <span class="size-picker">
                    ${widget.sizes.length > 1 ? widget.sizes.map((size) => `
                      <button type="button" class="size-picker__btn${entry.size === size ? " is-active" : ""}" data-size="${size}"
                        ${entry.enabled ? "" : "disabled"}>${SIZE_LABELS[size]}</button>`).join("") : ""}
                  </span>
                  <button type="button" class="switch${entry.enabled ? " is-on" : ""}" data-toggle role="switch"
                    aria-checked="${entry.enabled}" aria-label="Show ${widget.title}"><span class="switch__thumb"></span></button>
                </div>`;
            }).join("")}
          </section>`).join("")}
      </div>
    `;
  }

  #handleManagerClick(event) {
    const row = event.target.closest("[data-widget-id]");
    if (!row) return;
    const layout = this.#getLayout();
    const entry = layout.find((item) => item.id === row.dataset.widgetId);
    if (!entry) return;

    if (event.target.closest("[data-toggle]")) {
      entry.enabled = !entry.enabled;
    } else {
      const size = event.target.closest("[data-size]")?.dataset.size;
      if (!size) return;
      entry.size = size;
    }
    this.#saveLayout(layout);
    this.#renderManager();
  }

  #bindDragging() {
    if (!this.#grid) return;
    let dragged = null;

    this.#grid.addEventListener("pointerdown", (event) => {
      if (!event.target.closest('[data-role="drag-handle"]')) return;
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
