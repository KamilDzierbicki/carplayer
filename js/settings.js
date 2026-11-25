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
  }
}
