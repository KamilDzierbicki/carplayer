/**
 * <carplayer-open-link> - "Open link" tab: opens any web page in this browser, typed here or sent from a phone.
 * The phone QR code and the redirect itself are handled by ShareController.
 */
export default class CarplayerOpenLink extends HTMLElement {
  #rendered = false;

  connectedCallback() {
    if (this.#rendered) return;
    this.#rendered = true;

    this.innerHTML = `
      <carplayer-setup-card heading="Open a link" icon="share"
        note="Open any web page in this browser. Long links are easier to send from your phone."
        phone-step='Paste any link and tap "Redirect to that link". This browser opens it right away.'>
        <label class="field-label">Link
          <carplayer-clearable-input data-role="url" type="url"
            placeholder="https://example.com/very/long/link" class="field field--url">
          </carplayer-clearable-input>
        </label>
        <div class="button-row">
          <button class="btn btn--primary" data-action="open" type="button">Open</button>
        </div>
        <ul class="setup-facts">
          <li>The page replaces CarPlayer. Use the browser's back button to return.</li>
        </ul>
      </carplayer-setup-card>
    `;

    this.querySelector('[data-action="open"]').addEventListener("click", () => {
      const url = String(this.querySelector('[data-role="url"]').value || "").trim();
      this.dispatchEvent(new CustomEvent("open-url", { detail: { url }, bubbles: true }));
    });
  }

  get qrContainer() {
    return this.querySelector("carplayer-setup-card")?.qrContainer || null;
  }
}

customElements.define("carplayer-open-link", CarplayerOpenLink);
