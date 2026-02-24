export default class ShareController {
  #app;
  #storage;
  #playerController = null;

  #peer = null;
  #peerId = "";
  #peerReadyPromise = null;

  #shareSuccessTimeout = null;

  constructor(app, storage) {
    this.#app = app;
    this.#storage = storage;

    window.addEventListener("DOMContentLoaded", () => this.#handleDomReady());
  }

  setPlayerController(playerController) {
    this.#playerController = playerController;
  }

  async shareVideo(videoUrl) {
    if (!videoUrl) return;

    const targetPeerId = this.#getTargetPeerId();
    if (targetPeerId && this.#isShareMode()) {
      await this.#sendPayloadToCar({
        type: "video-url",
        value: videoUrl,
      });
      return;
    }

    this.#openHistoryShareLinkModal(videoUrl);
  }

  #handleDomReady() {
    this.#bindShareButtons();
    this.#handleInitialParams();
    this.#ensurePeerReady();
    this.#refreshRelayQrs();
  }

  #bindShareButtons() {
    const btnOpenLinkRelayModal = document.getElementById("btnOpenLinkRelayModal");
    if (btnOpenLinkRelayModal) {
      btnOpenLinkRelayModal.addEventListener("click", () => {
        this.#app.openModal("linkRelayModal");
        this.#refreshRelayQrs();
      });
    }

    const btnLoadCaptionUrl = document.getElementById("btnLoadCaptionUrl");
    const captionUrlInput = document.getElementById("captionUrlInput");
    if (btnLoadCaptionUrl && captionUrlInput) {
      btnLoadCaptionUrl.addEventListener("click", async () => {
        const captionUrl = captionUrlInput.value.trim();
        if (!captionUrl) {
          alert("Please paste a captions URL first.");
          return;
        }

        const loaded = await this.#playerController?.loadExternalCaptionUrl(captionUrl);
        if (!loaded) return;

        captionUrlInput.value = "";
        this.#app.closeModal("captionsModal");
      });
    }

    const btnShareFlow = document.getElementById("btnShareFlow");
    const shareVideoUrl = document.getElementById("shareVideoUrl");

    if (btnShareFlow && shareVideoUrl) {
      btnShareFlow.addEventListener("click", async () => {
        const videoUrl = shareVideoUrl.value.trim();
        if (!videoUrl) {
          alert("Please paste a Video URL first.");
          return;
        }

        const sent = await this.#sendPayloadToCar({
          type: "video-url",
          value: videoUrl,
        });

        if (!sent) return;

        this.#setShareFlowButtonState(btnShareFlow, true);

        clearTimeout(this.#shareSuccessTimeout);
        this.#shareSuccessTimeout = setTimeout(() => {
          this.#setShareFlowButtonState(btnShareFlow, false);
        }, 3000);

        shareVideoUrl.value = "";
        this.#app.closeModal("shareAppModal");
      });
    }

    const btnShareApiFlow = document.getElementById("btnShareApiFlow");
    if (btnShareApiFlow) {
      btnShareApiFlow.addEventListener("click", async () => {
        const mobileServerInput = document.getElementById("mobileJellyfinServerInput");
        const mobileApiInput = document.getElementById("mobileJellyfinApiKeyInput");
        if (!mobileServerInput || !mobileApiInput) return;

        const serverUrl = mobileServerInput.value.trim();
        const apiKey = mobileApiInput.value.trim();
        if (!serverUrl || !apiKey) {
          alert("Please paste Jellyfin server URL and API key first.");
          return;
        }

        const sent = await this.#sendPayloadToCar({
          type: "jellyfin-config",
          value: {
            serverUrl,
            apiKey,
          },
        });

        if (!sent) return;

        mobileServerInput.value = "";
        mobileApiInput.value = "";
        this.#app.closeModal("mobileApiModal");
        this.#setTemporarySuccessLabel(btnShareApiFlow, 2000);
      });
    }

    const btnShareCaptionFlow = document.getElementById("btnShareCaptionFlow");
    if (btnShareCaptionFlow) {
      btnShareCaptionFlow.addEventListener("click", async () => {
        const mobileCaptionUrlInput = document.getElementById("mobileCaptionUrlInput");
        if (!mobileCaptionUrlInput) return;

        const captionUrl = mobileCaptionUrlInput.value.trim();
        if (!captionUrl) {
          alert("Please paste a captions URL first.");
          return;
        }

        const normalizedCaptionUrl = this.#normalizeUrl(captionUrl);
        if (!normalizedCaptionUrl) {
          alert("Please paste a valid captions URL.");
          return;
        }

        const sent = await this.#sendPayloadToCar({
          type: "caption-url",
          value: normalizedCaptionUrl,
        });

        if (!sent) return;

        mobileCaptionUrlInput.value = "";
        this.#app.closeModal("mobileCaptionModal");
      });
    }

    const btnShareFlowSettings = document.getElementById("btnShareFlowSettings");
    if (btnShareFlowSettings) {
      btnShareFlowSettings.addEventListener("click", async () => {
        const serverInput = document.getElementById("jellyfinServerInput");
        const apiKeyInput = document.getElementById("apiKeyInput");
        const serverUrl = serverInput?.value.trim() || this.#storage.getJellyfinServerUrl();
        const apiKey = apiKeyInput?.value.trim() || this.#storage.getJellyfinApiKey();

        if (!serverUrl || !apiKey) {
          alert("Please provide Jellyfin server URL and API key first.");
          return;
        }

        const sent = await this.#sendPayloadToCar({
          type: "jellyfin-config",
          value: {
            serverUrl,
            apiKey,
          },
        });

        if (!sent) return;

        this.#setTemporarySuccessLabel(btnShareFlowSettings, 2000);
      });
    }

    const btnRedirectFlow = document.getElementById("btnRedirectFlow");
    if (btnRedirectFlow) {
      btnRedirectFlow.addEventListener("click", async () => {
        const mobileRedirectUrl = document.getElementById("mobileRedirectUrl");
        if (!mobileRedirectUrl) return;

        const normalizedUrl = this.#normalizeUrl(mobileRedirectUrl.value);
        if (!normalizedUrl) {
          alert("Please paste a valid URL first.");
          return;
        }

        const sent = await this.#sendPayloadToCar({
          type: "redirect-url",
          value: normalizedUrl,
        });

        if (!sent) return;

        this.#setTemporarySuccessLabel(btnRedirectFlow, 2000);
      });
    }

    const btnCopyHistoryShareLink = document.getElementById("btnCopyHistoryShareLink");
    if (btnCopyHistoryShareLink) {
      btnCopyHistoryShareLink.addEventListener("click", async () => {
        const input = document.getElementById("historyShareLinkInput");
        const link = input?.value.trim() || "";
        if (!link) return;

        try {
          await navigator.clipboard.writeText(link);
          this.#setTemporarySuccessLabel(btnCopyHistoryShareLink, 1800);
        } catch (error) {
          console.error("Copy failed", error);
          this.#app.fallbackCopyText(link);
        }
      });
    }
  }

  #handleInitialParams() {
    const params = new URLSearchParams(window.location.search);
    const autoUrl = params.get("url");
    const apiKey = params.get("apikey");
    const jfServer = params.get("jfserver");
    const jfApiKey = params.get("jfapikey");
    const jfUserId = params.get("jfuserid");

    if (apiKey) {
      this.#storage.saveApiKey(apiKey);
      alert("Jellyfin API key saved successfully!");
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (jfServer || jfApiKey || jfUserId) {
      this.#storage.saveJellyfinConfig({
        serverUrl: jfServer || this.#storage.getJellyfinServerUrl(),
        apiKey: jfApiKey || this.#storage.getJellyfinApiKey(),
        userId: jfUserId || this.#storage.getJellyfinUserId(),
      });
      alert("Jellyfin settings saved successfully!");
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (autoUrl) {
      if (this.#app.dom.urlInput) this.#app.dom.urlInput.value = autoUrl;
      this.#playerController?.loadVideo(autoUrl);
      return;
    }

    if (params.get("share") === "1") {
      this.#app.openModal("shareAppModal");
      return;
    }

    if (params.get("settings") === "1") {
      this.#app.openModal("mobileApiModal");
      return;
    }

    if (params.get("linkshare") === "1") {
      this.#app.openModal("mobileLinkRelayModal");
      return;
    }

    if (params.get("captionshare") === "1") {
      this.#app.openModal("mobileCaptionModal");
    }
  }

  #refreshRelayQrs() {
    this.#renderRelayQr({
      containerId: "qrcode",
      mode: "share",
      width: 250,
      height: 250,
    });

    this.#renderRelayQr({
      containerId: "settingsMobileQrcode",
      mode: "settings",
      width: 130,
      height: 130,
    });

    this.#renderRelayQr({
      containerId: "linkRelayQrcode",
      mode: "linkshare",
      width: 250,
      height: 250,
    });

    this.#renderRelayQr({
      containerId: "captionsRelayQrcode",
      mode: "captionshare",
      width: 250,
      height: 250,
    });
  }

  #renderRelayQr({ containerId, mode, width, height }) {
    const qrContainer = document.getElementById(containerId);
    if (!qrContainer) return;

    const relayUrl = this.#buildRelayUrl(mode);

    qrContainer.innerHTML = "";

    if (!relayUrl) {
      qrContainer.innerHTML =
        '<div class="loader loader-inline is-visible" aria-hidden="true"></div><div class="loader-text">Preparing secure relay...</div>';
      return;
    }

    new QRCode(qrContainer, {
      text: relayUrl,
      width,
      height,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H,
    });
  }

  #buildRelayUrl(mode) {
    const currentUrlObj = new URL(window.location.href);

    currentUrlObj.searchParams.delete("share");
    currentUrlObj.searchParams.delete("settings");
    currentUrlObj.searchParams.delete("url");
    currentUrlObj.searchParams.delete("apikey");
    currentUrlObj.searchParams.delete("jfserver");
    currentUrlObj.searchParams.delete("jfapikey");
    currentUrlObj.searchParams.delete("jfuserid");
    currentUrlObj.searchParams.delete("linkshare");
    currentUrlObj.searchParams.delete("captionshare");
    currentUrlObj.searchParams.delete("peer");

    if (mode === "share") {
      currentUrlObj.searchParams.set("share", "1");
    }

    if (mode === "settings") {
      currentUrlObj.searchParams.set("settings", "1");
    }

    if (mode === "linkshare") {
      currentUrlObj.searchParams.set("linkshare", "1");
    }

    if (mode === "captionshare") {
      currentUrlObj.searchParams.set("captionshare", "1");
    }

    if (!this.#peerId) return "";

    currentUrlObj.searchParams.set("peer", this.#peerId);

    return currentUrlObj.href;
  }

  #getTargetPeerId() {
    const params = new URLSearchParams(window.location.search);
    return (params.get("peer") || "").trim();
  }

  #isShareMode() {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("share") === "1"
      || params.get("settings") === "1"
      || params.get("captionshare") === "1"
    );
  }

  #ensurePeerReady() {
    if (this.#peerReadyPromise) return this.#peerReadyPromise;

    if (typeof window.Peer !== "function") {
      console.error("PeerJS is not available. Relay sharing is disabled.");
      this.#peerReadyPromise = Promise.resolve("");
      return this.#peerReadyPromise;
    }

    this.#peer = new window.Peer();

    this.#peerReadyPromise = new Promise((resolve) => {
      let settled = false;
      const finish = (peerId = "") => {
        if (settled) return;
        settled = true;
        resolve(peerId);
      };

      this.#peer.on("open", (id) => {
        this.#peerId = id || "";
        this.#refreshRelayQrs();
        finish(this.#peerId);
      });

      this.#peer.on("connection", (connection) => {
        this.#bindIncomingConnection(connection);
      });

      this.#peer.on("error", (error) => {
        console.error("Peer relay error", error);
        if (!this.#peerId) finish("");
      });

      this.#peer.on("close", () => {
        this.#peerId = "";
        this.#refreshRelayQrs();
      });
    });

    return this.#peerReadyPromise;
  }

  #bindIncomingConnection(connection) {
    if (!connection) return;

    connection.on("data", (payload) => {
      this.#handleIncomingPayload(payload);
    });

    connection.on("error", (error) => {
      console.error("Incoming relay connection error", error);
    });
  }

  #handleIncomingPayload(rawPayload) {
    let payload = rawPayload;

    if (typeof rawPayload === "string") {
      try {
        payload = JSON.parse(rawPayload);
      } catch (error) {
        payload = { type: "video-url", value: rawPayload };
      }
    }

    if (!payload || typeof payload !== "object") return;

    const type = String(payload.type || "").trim();

    if (type === "video-url") {
      const value = String(payload.value || "").trim();
      if (!value) return;
      this.#handleIncomingVideoUrl(value);
      return;
    }

    if (type === "api-key") {
      const value = String(payload.value || "").trim();
      if (!value) return;
      this.#handleIncomingApiKey(value);
      return;
    }

    if (type === "jellyfin-config") {
      this.#handleIncomingJellyfinConfig(payload.value);
      return;
    }

    if (type === "redirect-url") {
      const value = String(payload.value || "").trim();
      if (!value) return;
      this.#handleIncomingRedirectUrl(value);
      return;
    }

    if (type === "caption-url") {
      const value = String(payload.value || "").trim();
      if (!value) return;
      this.#handleIncomingCaptionUrl(value);
    }
  }

  #handleIncomingVideoUrl(videoUrl) {
    if (this.#app.dom.urlInput) {
      this.#app.dom.urlInput.value = videoUrl;
    }

    const shareVideoUrlInput = document.getElementById("shareVideoUrl");
    if (shareVideoUrlInput) {
      shareVideoUrlInput.value = videoUrl;
    }

    this.#app.closeModal("shareAppModal");
    this.#app.closeModal("urlModal");

    this.#playerController?.loadVideo(videoUrl);
  }

  #handleIncomingApiKey(apiKey) {
    this.#storage.saveApiKey(apiKey);

    const apiKeyInput = document.getElementById("apiKeyInput");
    if (apiKeyInput) apiKeyInput.value = apiKey;

    const mobileApiInput = document.getElementById("mobileJellyfinApiKeyInput");
    if (mobileApiInput) mobileApiInput.value = apiKey;

    this.#app.closeModal("mobileApiModal");

    alert("Jellyfin API key saved successfully!");
  }

  #handleIncomingJellyfinConfig(rawConfig) {
    if (!rawConfig || typeof rawConfig !== "object") return;

    const serverUrl = String(rawConfig.serverUrl || "").trim();
    const apiKey = String(rawConfig.apiKey || "").trim();
    const userId = String(rawConfig.userId || "").trim();
    if (!serverUrl || !apiKey) return;

    this.#storage.saveJellyfinConfig({
      serverUrl,
      apiKey,
      userId,
    });

    const serverInput = document.getElementById("jellyfinServerInput");
    if (serverInput) serverInput.value = serverUrl;

    const apiKeyInput = document.getElementById("apiKeyInput");
    if (apiKeyInput) apiKeyInput.value = apiKey;

    const mobileServerInput = document.getElementById("mobileJellyfinServerInput");
    if (mobileServerInput) mobileServerInput.value = serverUrl;

    const mobileApiInput = document.getElementById("mobileJellyfinApiKeyInput");
    if (mobileApiInput) mobileApiInput.value = apiKey;

    this.#app.closeModal("mobileApiModal");

    alert("Jellyfin settings saved successfully!");
  }

  #handleIncomingRedirectUrl(redirectUrl) {
    const normalizedUrl = this.#normalizeUrl(redirectUrl);
    if (!normalizedUrl) return;
    window.location.assign(normalizedUrl);
  }

  async #handleIncomingCaptionUrl(captionUrl) {
    const captionUrlInput = document.getElementById("captionUrlInput");
    if (captionUrlInput) {
      captionUrlInput.value = captionUrl;
    }

    const mobileCaptionUrlInput = document.getElementById("mobileCaptionUrlInput");
    if (mobileCaptionUrlInput) {
      mobileCaptionUrlInput.value = captionUrl;
    }

    const loaded = await this.#playerController?.loadExternalCaptionUrl(captionUrl);
    if (!loaded) return;

    this.#app.closeModal("mobileCaptionModal");
    this.#app.closeModal("captionsModal");
  }

  #normalizeUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    try {
      const parsed = new URL(raw);
      if (!["http:", "https:"].includes(parsed.protocol)) return "";
      return parsed.href;
    } catch (error) {
      try {
        const parsed = new URL(`https://${raw}`);
        if (!["http:", "https:"].includes(parsed.protocol)) return "";
        return parsed.href;
      } catch (innerError) {
        return "";
      }
    }
  }

  async #sendPayloadToCar(payload) {
    const targetPeerId = this.#getTargetPeerId();
    if (!targetPeerId) {
      alert("No active car session found. Scan the QR code from the car screen first.");
      return false;
    }

    await this.#ensurePeerReady();

    if (!this.#peer) {
      alert("Secure relay is unavailable in this browser.");
      return false;
    }

    return new Promise((resolve) => {
      let settled = false;
      let failureNotified = false;

      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      const notifyFailure = () => {
        if (failureNotified) return;
        failureNotified = true;
        this.#notifyRelaySendFailure();
      };

      const connection = this.#peer.connect(targetPeerId, {
        reliable: true,
      });

      const timeoutId = setTimeout(() => {
        connection.close();
        notifyFailure();
        finish(false);
      }, 8000);

      connection.on("open", () => {
        try {
          connection.send(payload);
          setTimeout(() => connection.close(), 250);
          clearTimeout(timeoutId);
          finish(true);
        } catch (error) {
          console.error("Relay send failed", error);
          clearTimeout(timeoutId);
          connection.close();
          notifyFailure();
          finish(false);
        }
      });

      connection.on("error", (error) => {
        console.error("Relay connection failed", error);
        clearTimeout(timeoutId);
        connection.close();
        notifyFailure();
        finish(false);
      });
    });
  }

  #setShareFlowButtonState(button, success) {
    if (!button) return;
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.innerHTML;
    }

    button.innerHTML = success
      ? '<span class="icon icon--sm icon-mask icon-mask--check" aria-hidden="true"></span> Loaded'
      : button.dataset.defaultLabel;
    button.classList.toggle("success", success);
  }

  #setTemporarySuccessLabel(button, durationMs) {
    if (!button) return;

    const defaultLabel = button.dataset.defaultLabel || button.innerHTML;
    button.dataset.defaultLabel = defaultLabel;

    button.innerHTML =
      '<span class="icon icon--sm icon-mask icon-mask--check" aria-hidden="true"></span> Loaded';
    button.classList.add("success");

    setTimeout(() => {
      button.innerHTML = defaultLabel;
      button.classList.remove("success");
    }, durationMs);
  }

  #notifyRelaySendFailure() {
    alert("Failed to send data to car session. Please scan QR code again and retry.");
  }

  #openHistoryShareLinkModal(videoUrl) {
    const input = document.getElementById("historyShareLinkInput");
    if (input) input.value = videoUrl;
    this.#app.openModal("historyShareLinkModal");
  }
}
