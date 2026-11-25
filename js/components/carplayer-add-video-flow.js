export default class CarplayerAddVideoFlow extends HTMLElement {
  #rendered = false;

  connectedCallback() {
    if (!this.#rendered) {
      this.#render();
      this.#rendered = true;
    }
  }

  #render() {
    // Same setup card as the Tube and IPTV tabs: link form on the left, phone QR code on the right.
    this.innerHTML = `
      <carplayer-setup-card heading="Open a video" icon="link"
        note="Play a direct video link here, or send one from your phone."
        phone-step='Paste your video link and tap "Send to Car". It plays right here.'>
        <label class="field-label">Video link
          <carplayer-clearable-input id="videoUrl" type="url"
            placeholder="https://example.com/movie.mp4" class="field field--url">
          </carplayer-clearable-input>
        </label>
        <div class="button-row button-row--stack">
          <button class="btn btn--primary is-disabled" id="btnLoad" type="button">Play</button>
          <button class="btn btn--ghost" id="btnPlaySample" type="button">Play sample video</button>
        </div>
        <ul class="setup-facts">
          <li>Works with .mp4, .webm and HLS (.m3u8) links, also live streams.</li>
          <li>The server must allow CORS, as Jellyfin and Plex stream links do.</li>
        </ul>
      </carplayer-setup-card>
    `;

    this.dom = Object.fromEntries([...this.querySelectorAll('[id]')].map(el => [el.id, el]));
  }
}

customElements.define('carplayer-add-video-flow', CarplayerAddVideoFlow);
