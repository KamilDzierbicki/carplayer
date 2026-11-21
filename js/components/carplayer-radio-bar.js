/**
 * <carplayer-radio-bar> - mini player for the current radio station, shown above the dock on every tab.
 *
 * Methods: show({station, playing, favorite, status}), hide()
 * Events: 'radio-toggle', 'radio-stop', 'radio-favorite'
 */
export default class CarplayerRadioBar extends HTMLElement {
  #rendered = false;

  connectedCallback() {
    if (this.#rendered) return;
    this.#rendered = true;
    this.classList.add("hidden");

    this.innerHTML = `
      <div class="radio-bar">
        <span class="station-card__logo radio-bar__logo"></span>
        <span class="radio-bar__text">
          <span class="radio-bar__name"></span>
          <span class="radio-bar__status"></span>
        </span>
        <button class="icon-btn icon-btn--compact" data-action="favorite" type="button" aria-label="Favorite">
          <span class="icon icon--sm icon-mask icon-mask--heart-outline" aria-hidden="true"></span>
        </button>
        <button class="icon-btn" data-action="toggle" type="button" aria-label="Play or pause">
          <span class="icon icon--md icon-mask icon-mask--play" aria-hidden="true"></span>
        </button>
        <button class="icon-btn icon-btn--compact" data-action="stop" type="button" aria-label="Stop radio">
          <span class="icon icon--sm icon-mask icon-mask--stop" aria-hidden="true"></span>
        </button>
      </div>
    `;

    this.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action) this.dispatchEvent(new CustomEvent(`radio-${action}`, { bubbles: true }));
    });
  }

  show({ station, playing, favorite, status }) {
    this.classList.remove("hidden");
    const logo = this.querySelector(".radio-bar__logo");
    logo.replaceChildren();
    if (station.favicon) {
      const img = document.createElement("img");
      img.src = station.favicon;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => img.remove(), { once: true });
      logo.appendChild(img);
    }
    this.querySelector(".radio-bar__name").textContent = station.name;
    this.querySelector(".radio-bar__status").textContent = status || (playing ? "Playing" : "Paused");

    const toggleIcon = this.querySelector('[data-action="toggle"] .icon');
    toggleIcon.classList.toggle("icon-mask--play", !playing);
    toggleIcon.classList.toggle("icon-mask--pause", playing);

    const favIcon = this.querySelector('[data-action="favorite"] .icon');
    favIcon.classList.toggle("icon-mask--heart", favorite);
    favIcon.classList.toggle("icon-mask--heart-outline", !favorite);
    this.querySelector('[data-action="favorite"]').classList.toggle("is-active", favorite);
  }

  hide() {
    this.classList.add("hidden");
  }
}

customElements.define("carplayer-radio-bar", CarplayerRadioBar);
