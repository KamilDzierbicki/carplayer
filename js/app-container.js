import CarPlayerCore from "./app-core.js";
import StorageService from "./storage.js";
import HistoryRenderer from "./history.js";
import JellyfinService from "./jellyfin.js";
import PlayerController from "./player.js";
import SettingsController from "./settings.js";
import ShareController from "./share.js";
import MainController from "./main-controller.js";

export default class AppContainer {
  #app;
  #storage;
  #historyUI;
  #jellyfinService;
  #playerController;
  #settingsController;
  #shareController;
  #mainController;

  constructor() {
    this.#app = new CarPlayerCore();
    this.#storage = new StorageService(this.#app);

    this.#historyUI = new HistoryRenderer(this.#app, this.#storage);
    this.#jellyfinService = new JellyfinService(this.#app, this.#storage);
    this.#playerController = new PlayerController(this.#app, this.#storage);
    this.#settingsController = new SettingsController(this.#app, this.#storage);
    this.#shareController = new ShareController(this.#app, this.#storage);

    this.#wireDependencies();

    this.#mainController = new MainController({
      app: this.#app,
      storage: this.#storage,
      historyUI: this.#historyUI,
      playerController: this.#playerController,
      jellyfinService: this.#jellyfinService,
      settingsController: this.#settingsController,
    });
  }

  start() {
    this.#mainController.init();
  }

  #wireDependencies() {
    this.#storage.setHistoryRenderer(this.#historyUI);

    this.#jellyfinService.setSettingsController(this.#settingsController);
    this.#jellyfinService.setPlayerController(this.#playerController);
    this.#settingsController.setJellyfinService(this.#jellyfinService);

    this.#playerController.setDependencies({
      historyRenderer: this.#historyUI,
    });

    this.#shareController.setPlayerController(this.#playerController);

    this.#historyUI.setActions({
      playUrl: (url) => this.#playerController.loadVideo(url),
      playJellyfin: (itemId, title, serverBaseUrl) => this.#jellyfinService.load(itemId, title, serverBaseUrl),
      shareUrl: (url) => this.#shareController.shareVideo(url),
      openUrlModal: () => this.#app.openUrlModal(),
    });
  }
}
