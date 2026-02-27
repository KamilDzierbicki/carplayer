import "./components/carplayer-custom-select.js";
import "./components/carplayer-clearable-input.js";
import "./components/carplayer-modal.js";
import "./components/carplayer-progress-bar.js";
import "./components/carplayer-volume-control.js";
import "./components/carplayer-video-controls.js";
import "./components/carplayer-navbar.js";
import "./components/carplayer-history.js";
import "./components/carplayer-topbar.js";
import "./components/carplayer-jellyfin-search-results.js";
import "./components/carplayer-footer.js";
import "./components/carplayer-step-list.js";
import "./components/carplayer-step-item.js";
import "./components/carplayer-jellyfin-settings-form.js";
import "./components/carplayer-add-video-flow.js";
import "./components/carplayer-link-relay-flow.js";
import "./components/carplayer-add-captions-flow.js";
import "./components/carplayer-media-view.js";

import AppContainer from "./app-container.js";

const appContainer = new AppContainer();
appContainer.start();
