export default class CarplayerAddCaptionsFlow extends HTMLElement {
  #rendered = false;

  connectedCallback() {
    if (!this.#rendered) {
      this.render();
      this.#rendered = true;
    }
  }

  render() {
    this.innerHTML = `
            <p class="section-note section-note--center">
              Paste direct subtitle link (.srt / .vtt) for the currently playing video.
            </p>
            <carplayer-clearable-input id="captionUrlInput" type="url" placeholder="https://example.com/subtitles/movie.srt"
              class="field field--url">
            </carplayer-clearable-input>
            <button class="btn btn--primary btn--block" id="btnLoadCaptionUrl" type="button">
              Load Captions
            </button>

            <div class="qr-flow">
              <div class="qr-card" id="captionsRelayQrcode"></div>
              <carplayer-step-list title="Or send from phone:">
                <carplayer-step-item number="1">
                  <p>Scan this QR code with your phone.</p>
                </carplayer-step-item>
                <carplayer-step-item number="2">
                  <p>Paste subtitle link on your phone.</p>
                </carplayer-step-item>
                <carplayer-step-item number="3">
                  <p>Tap "Send to Car".</p>
                </carplayer-step-item>
              </carplayer-step-list>
            </div>
        `;
  }
}

if (!customElements.get('carplayer-add-captions-flow')) {
  customElements.define('carplayer-add-captions-flow', CarplayerAddCaptionsFlow);
}
