/**
 * <carplayer-dock> - bottom tab bar of the setup screen.
 *
 * Attribute: active (tab id)
 * Events: 'tab-select' { tab }
 */
export const DOCK_TABS = Object.freeze([
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "history", label: "History", icon: "history" },
  { id: "youtube", label: "YouTube", icon: "youtube" },
  { id: "iptv", label: "IPTV", icon: "tv" },
  { id: "radio", label: "Radio", icon: "radio" },
  { id: "link", label: "Link", icon: "link" },
  { id: "mirror", label: "Mirror", icon: "cast" },
]);

export default class CarplayerDock extends HTMLElement {
  static get observedAttributes() {
    return ["active"];
  }

  connectedCallback() {
    if (this.childElementCount) return;

    this.innerHTML = `
      <nav class="dock" aria-label="Sections">
        ${DOCK_TABS.map((tab) => `
          <button class="dock__item" type="button" data-tab="${tab.id}" aria-label="${tab.label}">
            <span class="dock__icon"><span class="icon icon--md icon-mask icon-mask--${tab.icon}" aria-hidden="true"></span></span>
            <span class="dock__label">${tab.label}</span>
          </button>
        `).join("")}
      </nav>
    `;

    this.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tab]");
      if (!button) return;
      this.dispatchEvent(new CustomEvent("tab-select", { detail: { tab: button.dataset.tab }, bubbles: true }));
    });

    this.#syncActive();
  }

  attributeChangedCallback() {
    this.#syncActive();
  }

  #syncActive() {
    const active = this.getAttribute("active");
    this.querySelectorAll("[data-tab]").forEach((button) => {
      const isActive = button.dataset.tab === active;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-current", isActive ? "page" : "false");
    });
  }
}

customElements.define("carplayer-dock", CarplayerDock);
