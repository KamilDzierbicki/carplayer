/**
 * <carplayer-setup-card> - "configure manually or send from phone" card used by tabs that need settings first.
 *
 * Attributes: heading, note, phone-step (text of the phone instruction)
 * Children: form fields and buttons, moved into the manual column.
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
          <h2 class="setup-card__title"></h2>
          <p class="section-note setup-card__note"></p>
        </header>
        <div class="setup-card__body">
          <div class="setup-card__manual"></div>
          <div class="setup-card__phone">
            <div class="qr-card setup-card__qr" data-role="qr"></div>
            <carplayer-step-list title="Or send it from your phone:">
              <carplayer-step-item number="1"><p>Scan this QR code with your phone.</p></carplayer-step-item>
              <carplayer-step-item number="2"><p class="setup-card__phone-step"></p></carplayer-step-item>
            </carplayer-step-list>
          </div>
        </div>
      </section>
    `;

    this.querySelector(".setup-card__title").textContent = this.getAttribute("heading") || "";
    const note = this.querySelector(".setup-card__note");
    note.textContent = this.getAttribute("note") || "";
    note.hidden = !note.textContent;
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
