export default class CarplayerAddVideoFlow extends HTMLElement {
  #rendered = false;

  connectedCallback() {
    if (!this.#rendered) {
      this.#render();
      this.#rendered = true;
    }
  }

  #render() {
    this.innerHTML = `
      <div class="qr-flow">
        <div class="qr-card" id="qrcode"></div>
        <carplayer-step-list title="How to send link via phone:">
          <carplayer-step-item number="1">
            <p>Scan this QR code with your phone.</p>
          </carplayer-step-item>
          <carplayer-step-item number="2">
            <p>Paste your video link on your phone.</p>
          </carplayer-step-item>
          <carplayer-step-item number="3">
            <p>Tap "Send to Car" - it will play right here!</p>
          </carplayer-step-item>
        </carplayer-step-list>
      </div>

      <carplayer-clearable-input id="videoUrl" type="url"
        placeholder="Video URL with valid CORS origin (.mp4 / Jellyfin or Plex stream link)" class="field field--url">
      </carplayer-clearable-input>
      <button class="btn btn--primary btn--block is-disabled" id="btnLoad" type="button">
        Play
      </button>
      <button class="btn btn--ghost btn--block" id="btnPlaySample" type="button">
        Or Play Sample Video
      </button>
    `;

    this.dom = Object.fromEntries([...this.querySelectorAll('[id]')].map(el => [el.id, el]));
  }
}

customElements.define('carplayer-add-video-flow', CarplayerAddVideoFlow);
