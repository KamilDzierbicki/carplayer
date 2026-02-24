import CarPlayerCore from "./app-core.js";
import StorageService from "./storage.js";
import HistoryRenderer from "./history.js";
import YouTubeService from "./youtube.js";
import PlayerController from "./player.js";
import SettingsController from "./settings.js";
import ShareController from "./share.js";
import MainController from "./main-controller.js";

export default class AppContainer {
  #app;
  #storage;
  #historyUI;
  #youtubeService;
  #playerController;
  #settingsController;
  #shareController;
  #mainController;

  constructor() {
    this.#app = new CarPlayerCore();
    this.#storage = new StorageService(this.#app);

    this.#historyUI = new HistoryRenderer(this.#app, this.#storage);
    this.#youtubeService = new YouTubeService(this.#app, this.#storage);
    this.#playerController = new PlayerController(this.#app, this.#storage);
    this.#settingsController = new SettingsController(this.#app, this.#storage);
    this.#shareController = new ShareController(this.#app, this.#storage);

    this.#wireDependencies();

    this.#mainController = new MainController({
      app: this.#app,
      storage: this.#storage,
      historyUI: this.#historyUI,
      playerController: this.#playerController,
      youtubeService: this.#youtubeService,
      settingsController: this.#settingsController,
    });
  }

  start() {
    this.#mainController.init();
  }

  #wireDependencies() {
    this.#storage.setHistoryRenderer(this.#historyUI);

    this.#youtubeService.setSettingsController(this.#settingsController);
    this.#settingsController.setYoutubeService(this.#youtubeService);

    this.#playerController.setDependencies({
      youtubeService: this.#youtubeService,
      historyRenderer: this.#historyUI,
    });

    this.#shareController.setPlayerController(this.#playerController);

    this.#historyUI.setActions({
      playUrl: (url) => this.#playerController.loadVideo(url),
      playYoutube: (videoId, title) => this.#youtubeService.load(videoId, title),
      shareUrl: (url) => this.#shareController.shareVideo(url),
      openUrlModal: () => this.#app.openUrlModal(),
    });
  }
}
