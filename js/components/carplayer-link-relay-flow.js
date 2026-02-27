export default class CarplayerLinkRelayFlow extends HTMLElement {
    constructor() {
        super();
        this._rendered = false;
    }

    connectedCallback() {
        if (!this._rendered) {
            this._render();
            this._rendered = true;
        }
    }

    _render() {
        this.innerHTML = `
            <p class="section-note section-note--center">
              Scan this QR code with your phone and send any URL. Car browser will redirect to that link immediately.
            </p>

            <div class="qr-flow">
              <div class="qr-card" id="linkRelayQrcode"></div>
              <carplayer-step-list>
                <carplayer-step-item number="1">
                  <p>Scan this QR code with your phone.</p>
                </carplayer-step-item>
                <carplayer-step-item number="2">
                  <p>Paste any long URL you want in the mobile popup.</p>
                </carplayer-step-item>
                <carplayer-step-item number="3">
                  <p>Tap "Redirect to that link".</p>
                </carplayer-step-item>
              </carplayer-step-list>
            </div>
        `;
    }
}

customElements.define('carplayer-link-relay-flow', CarplayerLinkRelayFlow);
