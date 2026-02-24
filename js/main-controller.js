export default class MainController {
  #app;
  #storage;
  #historyUI;
  #playerController;
  #youtubeService;
  #settingsController;
  #dom;

  constructor({
    app,
    storage,
    historyUI,
    playerController,
    youtubeService,
    settingsController,
  }) {
    this.#app = app;
    this.#storage = storage;
    this.#historyUI = historyUI;
    this.#playerController = playerController;
    this.#youtubeService = youtubeService;
    this.#settingsController = settingsController;
    this.#dom = app.dom;
  }

  init() {
    this.#initBaseState();
    this.#bindStaticActions();
    this.#bindUrlModalActions();
    this.#bindSearchActions();
  }

  #initBaseState() {
    this.#historyUI.render();

    this.#dom.video.volume = this.#storage.getVolume();
    this.#dom.volumeSlider.value = this.#dom.video.volume;

    this.#dom.video.playbackRate = this.#storage.getSpeed();
    this.#dom.speedSelect.value = this.#dom.video.playbackRate;
  }

  #bindStaticActions() {
    const logoLink = document.getElementById("logoLink");
    if (logoLink) {
      logoLink.addEventListener("click", (event) => {
        event.preventDefault();
        window.location.reload();
      });
    }

    const btnOpenUrlModal = document.getElementById("btnOpenUrlModal");
    if (btnOpenUrlModal) {
      btnOpenUrlModal.addEventListener("click", () => this.#app.openUrlModal());
    }

    const btnOpenSettings = document.getElementById("btnOpenSettings");
    if (btnOpenSettings) {
      btnOpenSettings.addEventListener("click", () => this.#settingsController.openModal());
    }

    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => {
        const modalId = button.dataset.closeModal;
        if (!modalId) return;
        this.#app.closeModal(modalId);
        this.#clearTransientUrlParams();
      });
    });

    document.querySelectorAll(".modal").forEach((modal) => {
      modal.addEventListener("click", (event) => {
        if (event.target !== modal) return;
        if (!modal.id) return;
        this.#app.closeModal(modal.id);
        this.#clearTransientUrlParams();
      });
    });
  }

  #clearTransientUrlParams() {
    const currentUrlObj = new URL(window.location.href);
    let hasChanges = false;
    const transientParams = ["share", "settings", "url", "apikey"];

    transientParams.forEach((param) => {
      if (!currentUrlObj.searchParams.has(param)) return;
      currentUrlObj.searchParams.delete(param);
      hasChanges = true;
    });

    if (!hasChanges) return;

    window.history.replaceState(
      {},
      document.title,
      `${currentUrlObj.pathname}${currentUrlObj.search}${currentUrlObj.hash}`,
    );
  }

  #bindUrlModalActions() {
    if (this.#dom.btnLoad && this.#dom.urlInput) {
      this.#dom.btnLoad.addEventListener("click", () => {
        const url = this.#dom.urlInput.value.trim();
        if (!url) return;

        this.#app.closeModal("urlModal");
        this.#playerController.loadVideo(url);
      });
    }

    const btnPlaySample = document.getElementById("btnPlaySample");
    if (btnPlaySample) {
      btnPlaySample.addEventListener("click", () => {
        this.#app.closeModal("urlModal");
        this.#playerController.loadVideo(
          "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
        );
      });
    }

    const clearVideoUrlBtn = document.getElementById("clearVideoUrlBtn");
    if (this.#dom.urlInput && clearVideoUrlBtn) {
      this.#dom.urlInput.addEventListener("input", (event) => {
        const hasValue = event.target.value.length > 0;
        clearVideoUrlBtn.classList.toggle("is-visible", hasValue);

        if (this.#dom.btnLoad) {
          this.#dom.btnLoad.classList.toggle("is-disabled", !hasValue);
        }
      });

      clearVideoUrlBtn.addEventListener("click", () => {
        this.#dom.urlInput.value = "";
        clearVideoUrlBtn.classList.remove("is-visible");

        if (this.#dom.btnLoad) {
          this.#dom.btnLoad.classList.add("is-disabled");
        }

        this.#dom.urlInput.focus();
      });
    }
  }

  #bindSearchActions() {
    if (!this.#dom.searchInput) return;

    const clearSearchBtn = document.getElementById("clearSearchBtn");
    if (!clearSearchBtn) return;

    this.#dom.searchInput.addEventListener("input", (event) => {
      clearSearchBtn.classList.toggle("is-visible", event.target.value.length > 0);
    });

    clearSearchBtn.addEventListener("click", () => {
      this.#dom.searchInput.value = "";
      clearSearchBtn.classList.remove("is-visible");
      this.#historyUI.render();
    });

    this.#dom.searchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;

      event.preventDefault();
      document.activeElement.blur();

      const query = event.target.value.trim();
      if (!query) {
        this.#historyUI.render();
        return;
      }

      const apiKey = this.#storage.getApiKey();
      if (!apiKey) {
        this.#settingsController.openModal();
        return;
      }

      this.#youtubeService.search(query);
    });
  }
}
