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
    const serverInput = document.getElementById("jellyfinServerInput");
    const apiKeyInput = document.getElementById("apiKeyInput");
    const clearServerBtn = document.getElementById("clearJellyfinServerBtn");
    const clearApiBtn = document.getElementById("clearApiKeyBtn");

    if (!serverInput || !apiKeyInput || !clearServerBtn || !clearApiBtn) return;

    const config = this.#storage.getJellyfinConfig();
    serverInput.value = config.serverUrl;
    apiKeyInput.value = config.apiKey;

    const codecOptions = document.getElementById("jellyfinVideoCodecOptions");
    const codecValueEl = document.getElementById("jellyfinVideoCodecValue");

    let currentCodec = config.videoCodec || "h264";

    if (codecOptions && codecValueEl) {
      // Set initial state
      Array.from(codecOptions.children).forEach(opt => {
        if (opt.dataset.value === currentCodec) {
          opt.classList.add('is-selected');
          codecValueEl.textContent = opt.textContent;
        } else {
          opt.classList.remove('is-selected');
        }
      });

      // Bind click events on the options list
      codecOptions.onclick = (e) => {
        const option = e.target.closest('.custom-select__option');
        if (!option) return;

        currentCodec = option.dataset.value;
        codecValueEl.textContent = option.textContent;

        Array.from(codecOptions.children).forEach(opt => {
          opt.classList.toggle('is-selected', opt === option);
        });

        const wrapper = option.closest('.custom-select');
        if (wrapper) wrapper.blur();
      };
    }

    clearServerBtn.classList.toggle("is-visible", serverInput.value.trim().length > 0);
    clearApiBtn.classList.toggle("is-visible", apiKeyInput.value.trim().length > 0);

    serverInput.oninput = (event) => {
      const hasValue = event.target.value.trim().length > 0;
      clearServerBtn.classList.toggle("is-visible", hasValue);
    };

    apiKeyInput.oninput = (event) => {
      const hasValue = event.target.value.trim().length > 0;
      clearApiBtn.classList.toggle("is-visible", hasValue);
    };

    clearServerBtn.onclick = () => {
      serverInput.value = "";
      clearServerBtn.classList.remove("is-visible");
      serverInput.focus();
    };

    clearApiBtn.onclick = () => {
      apiKeyInput.value = "";
      clearApiBtn.classList.remove("is-visible");
      apiKeyInput.focus();
    };

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
        const serverInput = document.getElementById("jellyfinServerInput");
        const apiKeyInput = document.getElementById("apiKeyInput");

        if (!serverInput || !apiKeyInput) return;

        const serverUrl = serverInput.value.trim();
        const apiKey = apiKeyInput.value.trim();

        // Grab the selected codec by finding the .is-selected child
        let videoCodec = "h264";
        const codecOptions = document.getElementById("jellyfinVideoCodecOptions");
        if (codecOptions) {
          const selected = codecOptions.querySelector('.is-selected');
          if (selected) videoCodec = selected.dataset.value;
        }

        this.#storage.saveJellyfinConfig({
          serverUrl,
          apiKey,
          userId: "",
          videoCodec
        });

        this.#app.closeModal("settingsModal");
      });
    }
  }
}
