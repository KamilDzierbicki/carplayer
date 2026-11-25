/**
 * <carplayer-dock> - bottom tab bar of the setup screen.
 *
 * Attribute: active (tab id)
 * Events: 'tab-select' { tab }, 'dock-action' { action } for the buttons after the divider
 *   (fullscreen, theme, about); they open dialogs or toggle things instead of switching tabs.
 */
export const DOCK_TABS = Object.freeze([
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "history", label: "History", icon: "history" },
  { id: "jellyfin", label: "Jellyfin", icon: "library" },
  { id: "tube", label: "Tube", icon: "tube" },
  { id: "iptv", label: "IPTV", icon: "tv" },
  { id: "radio", label: "Radio", icon: "radio" },
  { id: "link", label: "Play link", icon: "link" },
  { id: "open-link", label: "Open link", icon: "share" },
  { id: "mirror", label: "Mirror", icon: "cast" },
]);

export const DOCK_ACTIONS = Object.freeze([
  { id: "fullscreen", label: "Fullscreen", icon: "fullscreen" },
  { id: "theme", label: "Theme", icon: "theme" },
  { id: "about", label: "About", icon: "info" },
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
        <span class="dock__divider" aria-hidden="true"></span>
        ${DOCK_ACTIONS.map((action) => `
          <button class="dock__item dock__item--action" type="button" data-action="${action.id}" aria-label="${action.label}" title="${action.label}">
            <span class="dock__icon"><span class="icon icon--md icon-mask icon-mask--${action.icon}" aria-hidden="true"></span></span>
            <span class="dock__label">${action.label}</span>
          </button>
        `).join("")}
      </nav>
    `;

    this.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (action) {
        this.dispatchEvent(new CustomEvent("dock-action", { detail: { action: action.dataset.action }, bubbles: true }));
        return;
      }
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
