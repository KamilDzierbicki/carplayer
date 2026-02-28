const RELAY_API_BASE = `${window.location.origin}/api/relay`;

export default class ShareController {
  #app;
  #storage;
  #playerController = null;

  #relaySession = null;
  #relaySessionPromise = null;
  #relayPollTimer = null;
  #lastRelayFailureReason = "";

  #shareSuccessTimeout = null;

  constructor(app, storage) {
    this.#app = app;
    this.#storage = storage;

    window.addEventListener("DOMContentLoaded", () => {
      void this.#handleDomReady();
    });
  }

  setPlayerController(playerController) {
    this.#playerController = playerController;
  }

  async shareVideo(videoUrl) {
    if (!videoUrl) return;

    const targetSession = this.#getTargetRelayCredentials();
    if (targetSession && this.#isShareMode()) {
      await this.#sendPayloadToCar({
        type: "video-url",
        value: videoUrl,
      });
      return;
    }

    this.#openHistoryShareLinkModal(videoUrl);
  }

  async #handleDomReady() {
    this.#bindShareButtons();
    this.#handleInitialParams();
  }

  #bindShareButtons() {
    const appNav = document.querySelector("carplayer-navbar");
    if (appNav) {
      appNav.addEventListener("action-send-link", () => {
        this.#app.openModal("linkRelayModal");
      });
    }

    document.addEventListener("modal-open", (e) => {
      const modalId = e.target?.id;
      if (!modalId) return;

      if (modalId === "linkRelayModal") {
        void this.#resumeRelayPollingOrRender({
          containerId: "linkRelayQrcode",
          mode: "linkshare",
          width: 250,
          height: 250,
        });
      } else if (modalId === "urlModal") {
        void this.#resumeRelayPollingOrRender({
          containerId: "qrcode",
          mode: "share",
          width: 250,
          height: 250,
          flowContext: "carplayer-add-video-flow",
        });
      } else if (modalId === "settingsModal") {
        void this.#resumeRelayPollingOrRender({
          containerId: "settingsMobileQrcode",
          mode: "settings",
          width: 240,
          height: 240,
          flowContext: "carplayer-jellyfin-settings-form",
        });
      } else if (modalId === "captionsModal") {
        void this.#resumeRelayPollingOrRender({
          containerId: "captionsRelayQrcode",
          mode: "captionshare",
          width: 250,
          height: 250,
          flowContext: "carplayer-add-captions-flow",
        });
      } else if (modalId === "mobileApiModal") {
        const mobileServerInput = document.getElementById("mobileJellyfinServerInput");
        const mobileApiInput = document.getElementById("mobileJellyfinApiKeyInput");
        if (mobileServerInput && mobileApiInput) {
          const serverUrl = this.#storage.getJellyfinServerUrl();
          const apiKey = this.#storage.getJellyfinApiKey();
          if (serverUrl) {
            mobileServerInput.value = serverUrl;
            mobileServerInput.setAttribute("value", serverUrl);
          }
          if (apiKey) {
            mobileApiInput.value = apiKey;
            mobileApiInput.setAttribute("value", apiKey);
          }
        }
      }
    });

    document.addEventListener("modal-close", (e) => {
      const activeModalClass = document.querySelector(".modal.active");
      if (!activeModalClass) {
        this.#stopRelayPolling();
      }
    });

    const captionsFlow = document.querySelector("carplayer-add-captions-flow");
    const btnLoadCaptionUrl = captionsFlow ? captionsFlow.querySelector("#btnLoadCaptionUrl") : null;
    const captionUrlInput = captionsFlow ? captionsFlow.querySelector("#captionUrlInput") : null;
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

    const shareAppModal = document.getElementById("shareAppModal");
    const btnShareFlow = shareAppModal ? shareAppModal.querySelector("#btnShareFlow") : document.getElementById("btnShareFlow");
    const shareVideoUrl = shareAppModal ? shareAppModal.querySelector("#shareVideoUrl") : document.getElementById("shareVideoUrl");

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

        this.#storage.saveJellyfinConfig({
          serverUrl,
          apiKey,
        });

        mobileServerInput.value = "";
        mobileApiInput.value = "";
        this.#app.closeModal("mobileApiModal");
        this.#setTemporarySuccessLabel(btnShareApiFlow, 2000);
      });
    }

    const mobileCaptionModal = document.getElementById("mobileCaptionModal");
    const btnShareCaptionFlow = mobileCaptionModal ? mobileCaptionModal.querySelector("#btnShareCaptionFlow") : document.getElementById("btnShareCaptionFlow");
    if (btnShareCaptionFlow) {
      btnShareCaptionFlow.addEventListener("click", async () => {
        const mobileCaptionUrlInput = mobileCaptionModal ? mobileCaptionModal.querySelector("#mobileCaptionUrlInput") : document.getElementById("mobileCaptionUrlInput");
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
        const serverInput = document.getElementById("jellyfinServer");
        const apiKeyInput = document.getElementById("apiKey");
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

    const mobileLinkRelayModal = document.getElementById("mobileLinkRelayModal");
    const btnRedirectFlow = mobileLinkRelayModal ? mobileLinkRelayModal.querySelector("#btnRedirectFlow") : document.getElementById("btnRedirectFlow");
    if (btnRedirectFlow) {
      btnRedirectFlow.addEventListener("click", async () => {
        const mobileRedirectUrl = mobileLinkRelayModal ? mobileLinkRelayModal.querySelector("#mobileRedirectUrl") : document.getElementById("mobileRedirectUrl");
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

  // #refreshRelayQrs() is removed, we do just-in-time rendering.

  async #resumeRelayPollingOrRender(config) {
    return this.#renderRelayQr(config);
  }

  async #renderRelayQr({ containerId, mode, width, height, flowContext }) {
    let qrContainer = null;
    if (flowContext) {
      const flow = document.querySelector(flowContext);
      if (flow) qrContainer = flow.querySelector(`#${containerId}`);
    }
    if (!qrContainer) qrContainer = document.getElementById(containerId);

    if (!qrContainer) return;

    if (!this.#isShareMode()) {
      qrContainer.innerHTML =
        '<div class="loader loader-inline is-visible" aria-hidden="true"></div><div class="loader-text">Preparing secure relay...</div>';

      const session = await this.#ensureRelaySessionReady();
      if (!session) {
        qrContainer.innerHTML = '<div class="error-text">Failed to connect to relay server.</div>';
        return;
      }

      this.#startRelayPolling();
    }

    const relayUrl = this.#buildRelayUrl(mode);
    qrContainer.innerHTML = "";

    if (!relayUrl) return;

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

    [
      "share",
      "settings",
      "url",
      "apikey",
      "jfserver",
      "jfapikey",
      "jfuserid",
      "linkshare",
      "captionshare",
      "peer",
      "ice",
      "sid",
      "wt",
      "relay",
    ].forEach((key) => currentUrlObj.searchParams.delete(key));

    if (mode === "share") currentUrlObj.searchParams.set("share", "1");
    if (mode === "settings") currentUrlObj.searchParams.set("settings", "1");
    if (mode === "linkshare") currentUrlObj.searchParams.set("linkshare", "1");
    if (mode === "captionshare") currentUrlObj.searchParams.set("captionshare", "1");

    if (!this.#relaySession?.sessionId || !this.#relaySession?.writeToken) return "";

    currentUrlObj.searchParams.set("relay", "1");
    currentUrlObj.searchParams.set("sid", this.#relaySession.sessionId);
    currentUrlObj.searchParams.set("wt", this.#relaySession.writeToken);

    return currentUrlObj.href;
  }

  #getTargetRelayCredentials() {
    const params = new URLSearchParams(window.location.search);
    const sessionId = String(params.get("sid") || "").trim();
    const writeToken = String(params.get("wt") || "").trim();

    if (!sessionId || !writeToken) return null;

    return { sessionId, writeToken };
  }

  #isShareMode() {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("share") === "1"
      || params.get("settings") === "1"
      || params.get("captionshare") === "1"
      || params.get("linkshare") === "1"
    );
  }

  async #ensureRelaySessionReady(force = false) {
    if (this.#isShareMode()) return null;

    if (!force && this.#isRelaySessionUsable(this.#relaySession)) {
      return this.#relaySession;
    }

    if (this.#relaySessionPromise) return this.#relaySessionPromise;

    this.#relaySessionPromise = (async () => {
      try {
        const session = await this.#createRelaySession();
        this.#relaySession = session;
        this.#lastRelayFailureReason = "";
        console.log(`[relay] Session ready. sid=${session.sessionId}, expiresAt=${session.expiresAt}`);
        return session;
      } catch (error) {
        this.#lastRelayFailureReason = this.#describeRelayError(error, "Unable to create relay session.");
        console.error("[relay] Session create failed", error);
        return null;
      } finally {
        this.#relaySessionPromise = null;
      }
    })();

    return this.#relaySessionPromise;
  }

  #isRelaySessionUsable(session) {
    if (!session?.sessionId || !session?.readToken || !session?.writeToken) return false;

    const expiresAtMs = Date.parse(String(session.expiresAt || ""));
    if (!Number.isFinite(expiresAtMs)) return true;

    return Date.now() < (expiresAtMs - 15000);
  }

  async #createRelaySession() {
    const response = await fetch(this.#relayApiUrl("/session/create"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ttlSeconds: 180,
      }),
    });

    const payload = await this.#parseJsonSafe(response);

    if (!response.ok) {
      const reason = payload?.error || `HTTP ${response.status}`;
      throw new Error(`Relay session create failed: ${reason}`);
    }

    const sessionId = String(payload?.sessionId || "").trim();
    const readToken = String(payload?.readToken || "").trim();
    const writeToken = String(payload?.writeToken || "").trim();
    const expiresAt = String(payload?.expiresAt || "").trim();

    if (!sessionId || !readToken || !writeToken) {
      throw new Error("Relay session response is missing required fields.");
    }

    return {
      sessionId,
      readToken,
      writeToken,
      expiresAt,
    };
  }

  #stopRelayPolling() {
    if (this.#relayPollTimer) {
      clearTimeout(this.#relayPollTimer);
      this.#relayPollTimer = null;
    }
  }

  #startRelayPolling() {
    this.#stopRelayPolling();

    const poll = async () => {
      if (!this.#relaySession) {
        this.#stopRelayPolling();
        return;
      }

      if (!this.#isRelaySessionUsable(this.#relaySession)) {
        console.warn("[relay] Session is near expiration. Polling paused until re-requested.");
        this.#stopRelayPolling();
        return;
      } else {
        await this.#pollRelayMessages(this.#relaySession);
      }

      this.#relayPollTimer = setTimeout(() => {
        void poll();
      }, 1200);
    };

    this.#relayPollTimer = setTimeout(() => {
      void poll();
    }, 500);
  }

  async #pollRelayMessages(session) {
    const query = new URLSearchParams({
      sid: session.sessionId,
      rt: session.readToken,
    });

    let response;
    try {
      response = await fetch(`${this.#relayApiUrl("/session/receive")}?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
    } catch (error) {
      console.warn("[relay] Poll failed due to network error", error);
      return;
    }

    if (response.status === 404 || response.status === 410) {
      console.warn(`[relay] Session invalid (${response.status}); stopping polling.`);
      this.#stopRelayPolling();
      return;
    }

    const payload = await this.#parseJsonSafe(response);

    if (!response.ok) {
      const reason = payload?.error || `HTTP ${response.status}`;
      console.warn(`[relay] Poll request failed: ${reason}`);
      return;
    }

    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    if (!messages.length) return;

    console.log(`[relay] Received ${messages.length} relay payload(s).`);

    messages.forEach((entry) => {
      const messagePayload = entry?.payload ?? entry;
      this.#handleIncomingPayload(messagePayload);
    });
  }

  async #sendPayloadToCar(payload) {
    const targetSession = this.#getTargetRelayCredentials();
    if (!targetSession) {
      alert("No active car session found. Scan the QR code from the car screen first.");
      return false;
    }

    let response;
    try {
      response = await fetch(this.#relayApiUrl("/session/send"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: targetSession.sessionId,
          writeToken: targetSession.writeToken,
          payload,
        }),
      });
    } catch (error) {
      const reason = this.#describeRelayError(error, "Network error while sending relay payload.");
      this.#notifyRelaySendFailure(reason);
      return false;
    }

    const responsePayload = await this.#parseJsonSafe(response);

    if (response.ok) {
      console.log("[relay] Payload sent successfully.");
      return true;
    }

    const errorText = responsePayload?.error || `HTTP ${response.status}`;

    if (response.status === 404 || response.status === 410) {
      this.#notifyRelaySendFailure("Car relay session expired. Scan the latest QR from the car.");
      return false;
    }

    if (response.status === 401 || response.status === 403) {
      this.#notifyRelaySendFailure("Relay authorization failed. Please scan QR again.");
      return false;
    }

    this.#notifyRelaySendFailure(`Relay send failed: ${errorText}`);
    return false;
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
      void this.#handleIncomingCaptionUrl(value);
    }
  }

  #handleIncomingVideoUrl(videoUrl) {
    if (this.#app.dom.urlInput) {
      this.#app.dom.urlInput.value = videoUrl;
    }

    const shareAppModal = document.getElementById("shareAppModal");
    const shareVideoUrlInput = shareAppModal ? shareAppModal.querySelector("#shareVideoUrl") : document.getElementById("shareVideoUrl");
    if (shareVideoUrlInput) {
      shareVideoUrlInput.value = videoUrl;
    }

    this.#app.closeModal("shareAppModal");
    this.#app.closeModal("urlModal");

    this.#playerController?.loadVideo(videoUrl);
  }

  #handleIncomingApiKey(apiKey) {
    this.#storage.saveApiKey(apiKey);

    const apiKeyInput = document.getElementById("apiKey");
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

    const serverInput = document.getElementById("jellyfinServer");
    if (serverInput) serverInput.value = serverUrl;

    const apiKeyInput = document.getElementById("apiKey");
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
    const captionsFlow = document.querySelector("carplayer-add-captions-flow");
    const captionUrlInput = captionsFlow ? captionsFlow.querySelector("#captionUrlInput") : document.getElementById("captionUrlInput");
    if (captionUrlInput) {
      captionUrlInput.value = captionUrl;
    }

    const mobileCaptionModal = document.getElementById("mobileCaptionModal");
    const mobileCaptionUrlInput = mobileCaptionModal ? mobileCaptionModal.querySelector("#mobileCaptionUrlInput") : document.getElementById("mobileCaptionUrlInput");
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

  #relayApiUrl(path) {
    const base = RELAY_API_BASE.replace(/\/+$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${normalizedPath}`;
  }

  async #parseJsonSafe(response) {
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  #describeRelayError(error, fallbackMessage = "") {
    if (!error) return fallbackMessage;

    const code = String(error.type || error.code || "").trim();
    const message = String(error.message || "").trim();

    if (code && message) return `${code}: ${message}`;
    if (message) return message;
    if (code) return code;
    return fallbackMessage;
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

  #notifyRelaySendFailure(details = "") {
    const suffix = details ? `\nDetails: ${details}` : "";
    alert(`Failed to send data to car session. Please scan QR code again and retry.${suffix}`);
  }

  #openHistoryShareLinkModal(videoUrl) {
    const input = document.getElementById("historyShareLinkInput");
    if (input) input.value = videoUrl;
    this.#app.openModal("historyShareLinkModal");
  }
}
