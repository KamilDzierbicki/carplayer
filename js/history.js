export default class HistoryRenderer {
  #storage;
  #component;
  #actions;

  constructor(_app, storage) {
    this.#storage = storage;
    this.#component = document.getElementById("historyComponent");
    this.#actions = {
      playUrl: () => { },
      playJellyfin: () => { },
      shareUrl: () => { },
      openUrlModal: () => { },
    };

    this.#bindDelegatedActions();
  }

  setActions(actions) {
    this.#actions = {
      ...this.#actions,
      ...actions,
    };
  }

  render(filterQuery = "") {
    if (!this.#component) return;
    const history = this.#storage.getHistory();
    this.#component.searchQuery = filterQuery;
    this.#component.history = history;
  }

  #bindDelegatedActions() {
    if (!this.#component) return;

    this.#component.addEventListener("clear-history", () => {
      this.#storage.clearHistory();
    });

    this.#component.addEventListener("remove-item", (event) => {
      this.#storage.removeHistory(event.detail.id);
    });

    this.#component.addEventListener("share-item", (event) => {
      this.#actions.shareUrl(event.detail.url);
    });

    this.#component.addEventListener("play-url", (event) => {
      this.#actions.playUrl(event.detail.url);
    });

    this.#component.addEventListener("play-jellyfin", (event) => {
      const { itemId, title, serverBaseUrl } = event.detail;
      this.#actions.playJellyfin(itemId, title, serverBaseUrl);
    });

    const searchComponent = document.getElementById("jellyfinSearchComponent");
    if (searchComponent) {
      searchComponent.addEventListener("play-jellyfin", (event) => {
        const { itemId, title, serverBaseUrl } = event.detail;
        this.#actions.playJellyfin(itemId, title, serverBaseUrl);
      });
    }

    this.#component.addEventListener("open-url-modal", () => {
      this.#actions.openUrlModal();
    });
  }
}

