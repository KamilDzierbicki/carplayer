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
import TubeController from "./tube.js";
import JellyfinTabController from "./jellyfin-tab.js";
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
    this.#tabController = new TabController();
    this.#featureControllers = {
      dashboard: new DashboardController(featureDeps),
      tube: new TubeController(featureDeps),
      jellyfin: new JellyfinTabController(featureDeps),
      iptv: new IptvController(featureDeps),
      radio: new RadioController(featureDeps),
      mirror: new MirrorController(featureDeps),
      transfer: new SettingsTransferController(featureDeps),
    };
    this.#featureControllers.dashboard.setFavoritePlayers({
      ...this.#featureControllers,
      playVideo: (entry) => this.#playSaved(entry),
    });

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
    this.#featureControllers.tube.init();
    this.#featureControllers.jellyfin.init();
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
      // Keep the stored title and source of Tube / IPTV entries instead of deriving one from the URL.
      playUrl: (url) => this.#playSaved(this.#storage.getHistory().find((entry) => entry.id === url) || { id: url }),
      playJellyfin: (itemId, title, serverBaseUrl) => this.#jellyfinService.load(itemId, title, serverBaseUrl),
      shareUrl: (url) => this.#shareController.shareVideo(url),
      openUrlModal: () => this.#app.openUrlModal(),
    });
  }

  /** Plays a history or favorite entry ({ id, title, sourceType, thumbnailUrl }) the way it was first opened. */
  #playSaved(entry) {
    const jellyfin = JellyfinService.parseSessionUrl(entry.id);
    if (jellyfin) return this.#jellyfinService.load(jellyfin.itemId, entry.title, jellyfin.serverBaseUrl);
    // "youtube" is the source type of history entries saved before the rename.
    const isTube = ["tube", "youtube"].includes(entry.sourceType);
    const tubeId = isTube ? entry.id.match(this.#app.tubeLinkRegex)?.[1] : "";
    if (tubeId) return this.#featureControllers.tube.play(tubeId, entry.title);
    // IPTV goes through its controller, which routes HTTP channels through the CORS proxy.
    if (entry.sourceType === "iptv") {
      return this.#featureControllers.iptv.playUrl(entry.id, entry.title, entry.thumbnailUrl);
    }
    return this.#playerController.loadVideo(entry.id, {
      title: entry.title,
      sourceType: entry.sourceType,
      thumbnailUrl: entry.thumbnailUrl,
    });
  }
}
