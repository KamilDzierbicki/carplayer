export default class SettingsController {
  #app;
  #storage;
  #jellyfinService = null;

  constructor(app, storage) {
    this.#app = app;
    this.#storage = storage;

    this.#bindPersistentEvents();
  }

  setJellyfinService(jellyfinService) {
    this.#jellyfinService = jellyfinService;
  }

  openModal() {
    const serverInput = document.getElementById("jellyfinServer");
    const apiKeyInput = document.getElementById("apiKey");
    const codecSelect = document.getElementById("jellyfinVideoCodec");
    const bufferInput = document.getElementById("videoBuffer");

    if (!serverInput || !apiKeyInput) return;

    const config = this.#storage.getJellyfinConfig();
    serverInput.value = config.serverUrl;
    apiKeyInput.value = config.apiKey;

    // Set codec select value via Web Component API
    if (codecSelect) {
      codecSelect.value = config.videoCodec || 'h264';
    }

    if (bufferInput) {
      bufferInput.value = String(this.#storage.getVideoBuffer());
    }

    this.#app.openModal("settingsModal");
  }

  #bindPersistentEvents() {
    const btnClearHistory = document.getElementById("btnClearHistory");
    if (btnClearHistory) {
      btnClearHistory.addEventListener("click", () => {
        if (confirm("Are you sure you want to clear all history and saved playback positions?")) {
          this.#storage.clearHistory();
        }
      });
    }

    const btnSaveSettings = document.getElementById("btnSaveSettings");
    if (btnSaveSettings) {
      btnSaveSettings.addEventListener("click", () => {
        const serverInput = document.getElementById("jellyfinServer");
        const apiKeyInput = document.getElementById("apiKey");
        const codecSelect = document.getElementById("jellyfinVideoCodec");
        const bufferInput = document.getElementById("videoBuffer");

        if (!serverInput || !apiKeyInput) return;

        const serverUrl = serverInput.value.trim();
        const apiKey = apiKeyInput.value.trim();
        const videoCodec = codecSelect?.value || "h264";

        this.#storage.saveJellyfinConfig({
          serverUrl,
          apiKey,
          userId: "",
          videoCodec
        });

        if (bufferInput && bufferInput.value) {
          const parsedBuffer = parseFloat(bufferInput.value);
          if (!isNaN(parsedBuffer) && parsedBuffer > 0) {
            this.#storage.saveVideoBuffer(parsedBuffer);
          }
        }

        this.#app.closeModal("settingsModal");
      });
    }
  }
}
