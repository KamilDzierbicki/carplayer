/**
 * <carplayer-setup-card> - "type it here or send it from your phone" card used by tabs that need settings first.
 *
 * Attributes: heading, note, icon (icon-mask name), phone-step (text of the phone instruction)
 * Children: form fields and buttons, moved into the manual panel. A child `<ul class="setup-facts">`
 *           is shown under them as short hints.
 * Property: qrContainer - element where the phone relay QR code is rendered.
 */
export default class CarplayerSetupCard extends HTMLElement {
  #rendered = false;

  connectedCallback() {
    if (this.#rendered) return;
    this.#rendered = true;

    const fields = Array.from(this.childNodes);
    this.innerHTML = `
      <section class="setup-card">
        <header class="setup-card__header">
          <span class="setup-card__badge"><span class="icon icon-mask" aria-hidden="true"></span></span>
          <div class="setup-card__heading">
            <h2 class="setup-card__title"></h2>
            <p class="setup-card__note"></p>
          </div>
        </header>
        <div class="setup-card__body">
          <div class="setup-card__panel setup-card__manual"></div>
          <div class="setup-card__divider" aria-hidden="true"><span>or</span></div>
          <div class="setup-card__panel setup-card__phone">
            <span class="setup-card__eyebrow">Send it from your phone</span>
            <div class="qr-card setup-card__qr" data-role="qr"></div>
            <ol class="setup-card__steps">
              <li>Scan this QR code with your phone camera.</li>
              <li class="setup-card__phone-step"></li>
            </ol>
          </div>
        </div>
      </section>
    `;

    this.querySelector(".setup-card__title").textContent = this.getAttribute("heading") || "";
    const note = this.querySelector(".setup-card__note");
    note.textContent = this.getAttribute("note") || "";
    note.hidden = !note.textContent;
    this.querySelector(".setup-card__badge .icon").classList.add(`icon-mask--${this.getAttribute("icon") || "settings"}`);
    this.querySelector(".setup-card__phone-step").textContent =
      this.getAttribute("phone-step") || 'Paste the value and tap "Send to Car".';

    const manual = this.querySelector(".setup-card__manual");
    fields.forEach((node) => manual.appendChild(node));
  }

  get qrContainer() {
    return this.querySelector('[data-role="qr"]');
  }
}

customElements.define("carplayer-setup-card", CarplayerSetupCard);
