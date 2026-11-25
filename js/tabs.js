import { DOCK_TABS } from "./components/carplayer-dock.js";

/**
 * Switches setup-screen sections (Dashboard, History, Tube, IPTV, Radio, Link, Mirror).
 * Other modules ask for a tab with `document.dispatchEvent(new CustomEvent("request-tab", {detail: {tab}}))`
 * and react to `tab-change` { tab, previous } on document.
 * The open tab lives in the URL hash (#iptv; the Dashboard has none), so a reload stays on it and the browser's
 * back button returns to the previous tab.
 */
export default class TabController {
  #dock;
  #activeTab = "";

  constructor() {
    this.#dock = document.getElementById("appDock");

    this.#dock?.addEventListener("tab-select", (event) => this.select(event.detail.tab));
    document.addEventListener("request-tab", (event) => this.select(event.detail?.tab));
    window.addEventListener("hashchange", () => this.select(this.#tabFromHash(), { updateUrl: false }));
  }

  get activeTab() {
    return this.#activeTab;
  }

  /**
   * Opens the tab named in the URL, or the Dashboard. The URL is left as it is here: a hash that is not a tab,
   * such as #importsettings=..., still has to be read by the settings import.
   */
  init() {
    this.select(this.#tabFromHash(), { updateUrl: false });
  }

  select(tabId, { updateUrl = true } = {}) {
    const tab = DOCK_TABS.find((entry) => entry.id === tabId)?.id || DOCK_TABS[0].id;
    const previous = this.#activeTab;

    document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.tabPanel !== tab);
    });
    this.#dock?.setAttribute("active", tab);
    this.#activeTab = tab;

    if (updateUrl && this.#tabFromHash() !== tab) {
      const hash = tab === DOCK_TABS[0].id ? "" : `#${tab}`;
      history.pushState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    }

    if (tab !== previous) {
      document.getElementById("setupScreen")?.scrollTo({ top: 0 });
      document.dispatchEvent(new CustomEvent("tab-change", { detail: { tab, previous } }));
    }
  }

  #tabFromHash() {
    const id = decodeURIComponent(window.location.hash.slice(1));
    return DOCK_TABS.some((entry) => entry.id === id) ? id : DOCK_TABS[0].id;
  }
}
