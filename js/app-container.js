import CarPlayerCore from "./app-core.js";
import StorageService from "./storage.js";
import HistoryRenderer from "./history.js";
import JellyfinService from "./jellyfin.js";
import PlayerController from "./player.js";
import SettingsController from "./settings.js";
import ShareController from "./share.js";
import MainController from "./main-controller.js";
import TabController from "./tabs.js";
import DashboardController from "./dashboard.js";
import YouTubeController from "./youtube.js";
import IptvController from "./iptv.js";
import RadioController from "./radio.js";
import MirrorController from "./mirror.js";
import SettingsTransferController from "./settings-transfer.js";

export default class AppContainer {
  #app;
  #storage;
  #historyUI;
  #jellyfinService;
  #playerController;
  #settingsController;
  #shareController;
  #mainController;
  #tabController;
  #featureControllers;

  constructor() {
    this.#app = new CarPlayerCore();
    this.#storage = new StorageService(this.#app);

    this.#historyUI = new HistoryRenderer(this.#app, this.#storage);
    this.#jellyfinService = new JellyfinService(this.#app, this.#storage);
    this.#playerController = new PlayerController(this.#app, this.#storage);
    this.#settingsController = new SettingsController(this.#app, this.#storage);
    this.#shareController = new ShareController(this.#app, this.#storage);

    this.#wireDependencies();

    // Feature controllers register relay modes before ShareController reads the URL on DOMContentLoaded.
    const featureDeps = {
      app: this.#app,
      storage: this.#storage,
      share: this.#shareController,
      player: this.#playerController,
      jellyfinService: this.#jellyfinService,
    };
    this.#tabController = new TabController(this.#storage);
    this.#featureControllers = {
      dashboard: new DashboardController(featureDeps),
      youtube: new YouTubeController(featureDeps),
      iptv: new IptvController(featureDeps),
      radio: new RadioController(featureDeps),
      mirror: new MirrorController(featureDeps),
      transfer: new SettingsTransferController(featureDeps),
    };

    this.#mainController = new MainController({
      app: this.#app,
      storage: this.#storage,
      historyUI: this.#historyUI,
      playerController: this.#playerController,
      jellyfinService: this.#jellyfinService,
      settingsController: this.#settingsController,
      shareController: this.#shareController,
    });
  }

  start() {
    this.#mainController.init();
    this.#featureControllers.youtube.init();
    this.#featureControllers.iptv.init();
    this.#featureControllers.radio.init();
    this.#tabController.init();
    void this.#featureControllers.transfer.handleImportLink();
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
      playUrl: (url) => {
        // Keep the stored title and source of YouTube / IPTV entries instead of deriving one from the URL.
        const item = this.#storage.getHistory().find((entry) => entry.id === url);
        const youtubeId = item?.sourceType === "youtube" ? url.match(this.#app.youtubeRegex)?.[1] : "";
        if (youtubeId) return this.#featureControllers.youtube.play(youtubeId, item.title);
        return this.#playerController.loadVideo(url, {
          title: item?.title,
          sourceType: item?.sourceType,
          thumbnailUrl: item?.thumbnailUrl,
        });
      },
      playJellyfin: (itemId, title, serverBaseUrl) => this.#jellyfinService.load(itemId, title, serverBaseUrl),
      shareUrl: (url) => this.#shareController.shareVideo(url),
      openUrlModal: () => this.#app.openUrlModal(),
    });
  }
}
