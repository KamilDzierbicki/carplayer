export default class CarplayerJellyfinSettingsForm extends HTMLElement {
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
            <p class="section-note">
              Add your Jellyfin server URL and API key to enable in-app search and playback from your personal library.
            </p>

            <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem;">
              <carplayer-clearable-input id="jellyfinServer" type="url" placeholder="https://your-jellyfin-server.example.com"
                class="field field--api">
              </carplayer-clearable-input>

              <carplayer-clearable-input id="apiKey" type="text" placeholder="Paste your Jellyfin API key"
                class="field field--api">
              </carplayer-clearable-input>

              <div class="field field--api">
                <label for="jellyfinVideoCodec"
                  style="color: var(--color-ink); font-size: 0.9rem; font-weight: 600; margin-bottom: 0.5rem; display: block;">Video
                  Codec</label>
                <carplayer-custom-select id="jellyfinVideoCodec" title="Video Codec" value="h264" class="custom-select--large">
                  <option value="h264" selected>H.264 (Default/Safest)</option>
                  <option value="h265">H.265 (HEVC)</option>
                  <option value="av1">AV1</option>
                </carplayer-custom-select>
              </div>

              <div class="field field--api">
                  <label for="videoBuffer" style="color: var(--color-ink); font-size: 0.9rem; font-weight: 600; margin-bottom: 0.5rem; display: block;">Video Buffer (seconds)</label>
                  <carplayer-clearable-input id="videoBuffer" type="number" placeholder="30"
                    class="field field--api">
                  </carplayer-clearable-input>
              </div>
            </div>

            <button class="btn btn--primary btn--block" id="btnSaveSettings" type="button" style="margin-top: 1.5rem;">Save
              Settings</button>

            <carplayer-step-list title="Scan QR below and send Jellyfin settings from phone">
              <carplayer-step-item number="1">
                Paste server URL and API key on your mobile, then tap <b>Send to Car</b>.
              </carplayer-step-item>
              <div class="qr-panel" id="settingsMobileQrcode"></div>
            </carplayer-step-list>
            
            <div class="modal__footer">
              <span>Made with &lt;3 from Poland by kamilmlody5</span>
              <a href="https://github.com/KamilDzierbicki/carplayer" target="_blank" rel="noopener noreferrer"
                class="link-github" title="View Source on GitHub">
                <span class="icon icon--lg icon-mask icon-mask--github" aria-hidden="true"></span>
              </a>
            </div>
        `;
  }
}

customElements.define('carplayer-jellyfin-settings-form', CarplayerJellyfinSettingsForm);
