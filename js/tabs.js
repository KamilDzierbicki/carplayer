import { DOCK_TABS } from "./components/carplayer-dock.js";

/**
 * Switches setup-screen sections (Dashboard, History, YouTube, IPTV, Radio, Link, Mirror).
 * Other modules ask for a tab with `document.dispatchEvent(new CustomEvent("request-tab", {detail: {tab}}))`
 * and react to `tab-change` { tab, previous } on document.
 */
export default class TabController {
  #storage;
  #dock;
  #activeTab = "";

  constructor(storage) {
    this.#storage = storage;
    this.#dock = document.getElementById("appDock");

    this.#dock?.addEventListener("tab-select", (event) => this.select(event.detail.tab));
    document.addEventListener("request-tab", (event) => this.select(event.detail?.tab));
  }

  get activeTab() {
    return this.#activeTab;
  }

  init() {
    this.select(this.#storage.getActiveTab(), { persist: false });
  }

  select(tabId, options = { persist: true }) {
    const tab = DOCK_TABS.find((entry) => entry.id === tabId)?.id || DOCK_TABS[0].id;
    const previous = this.#activeTab;

    document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.tabPanel !== tab);
    });
    this.#dock?.setAttribute("active", tab);
    this.#activeTab = tab;
    if (options.persist !== false) this.#storage.saveActiveTab(tab);

    if (tab !== previous) {
      document.getElementById("setupScreen")?.scrollTo({ top: 0 });
      document.dispatchEvent(new CustomEvent("tab-change", { detail: { tab, previous } }));
    }
  }
}
