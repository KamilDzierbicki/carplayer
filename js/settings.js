export default class SettingsController {
  #app;
  #storage;
  #youtubeService = null;

  constructor(app, storage) {
    this.#app = app;
    this.#storage = storage;

    this.#bindPersistentEvents();
  }

  setYoutubeService(youtubeService) {
    this.#youtubeService = youtubeService;
  }

  openModal() {
    const apiKeyInput = document.getElementById("apiKeyInput");
    const clearApiBtn = document.getElementById("clearApiKeyBtn");
    const quotaContainer = document.getElementById("apiQuotaContainer");

    if (!apiKeyInput || !clearApiBtn) return;

    const currentApi = this.#storage.getApiKey();
    apiKeyInput.value = currentApi;

    if (currentApi) {
      clearApiBtn.classList.add("is-visible");
      this.#updateQuotaUi(this.#storage.getApiQuotaUsage());
    } else {
      clearApiBtn.classList.remove("is-visible");
      if (quotaContainer) quotaContainer.classList.remove("is-visible");
    }

    apiKeyInput.oninput = (event) => {
      const hasValue = event.target.value.trim().length > 0;
      clearApiBtn.classList.toggle("is-visible", hasValue);
    };

    clearApiBtn.onclick = () => {
      apiKeyInput.value = "";
      clearApiBtn.classList.remove("is-visible");
      if (quotaContainer) quotaContainer.classList.remove("is-visible");
      localStorage.removeItem("carplayer_api_quota_month");
      localStorage.removeItem("carplayer_api_quota_count");
    };

    this.#app.openModal("settingsModal");

    const rapidApiQrContainer = document.getElementById("rapidApiQrcode");
    if (rapidApiQrContainer) {
      rapidApiQrContainer.innerHTML = "";
      new QRCode(rapidApiQrContainer, {
        text: "https://rapidapi.com/ytjar/api/yt-api",
        width: 130,
        height: 130,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });
    }

    const mobileSettingsQrContainer = document.getElementById("settingsMobileQrcode");
    if (mobileSettingsQrContainer) {
      const currentUrlObj = new URL(window.location.href);
      currentUrlObj.searchParams.delete("share");
      currentUrlObj.searchParams.delete("url");
      currentUrlObj.searchParams.delete("apikey");
      currentUrlObj.searchParams.delete("settings");
      currentUrlObj.searchParams.set("settings", "1");

      mobileSettingsQrContainer.innerHTML = "";
      new QRCode(mobileSettingsQrContainer, {
        text: currentUrlObj.href,
        width: 130,
        height: 130,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });
    }

    const btnShareFlowSettings = document.getElementById("btnShareFlowSettings");
    if (btnShareFlowSettings) {
      btnShareFlowSettings.onclick = async () => {
        const key = apiKeyInput.value.trim() || this.#storage.getApiKey();
        if (!key) {
          alert("Please provide an API Key first.");
          return;
        }

        const currentUrlObj = new URL(window.location.href);
        currentUrlObj.searchParams.delete("settings");
        currentUrlObj.searchParams.set("apikey", key);
        const shareUrl = currentUrlObj.href;

        if (navigator.share) {
          try {
            await navigator.share({
              title: "Send API Key to Car",
              text: "Send this to the Car app to authorise YouTube API.",
              url: shareUrl,
            });
            return;
          } catch (error) {
            if (error.name === "AbortError") return;
          }
        }

        this.#app.fallbackCopyText(shareUrl);
      };
    }
  }

  #bindPersistentEvents() {
    const btnClearHistory = document.getElementById("btnClearHistory");
    if (btnClearHistory) {
      btnClearHistory.addEventListener("click", () => {
        if (
          confirm(
            "Are you sure you want to clear all history and saved playback positions?",
          )
        ) {
          this.#storage.clearHistory();
        }
      });
    }

    const btnSaveSettings = document.getElementById("btnSaveSettings");
    if (btnSaveSettings) {
      btnSaveSettings.addEventListener("click", () => {
        const input = document.getElementById("apiKeyInput");
        if (!input) return;

        const key = input.value.trim();
        const oldKey = this.#storage.getApiKey();
        if (key !== oldKey) {
          localStorage.removeItem("carplayer_api_quota_month");
          localStorage.removeItem("carplayer_api_quota_count");
        }

        this.#storage.saveApiKey(key);
        this.#app.closeModal("settingsModal");
      });
    }
  }

  #updateQuotaUi(usage) {
    const quotaContainer = document.getElementById("apiQuotaContainer");
    const quotaText = document.getElementById("apiQuotaText");
    const quotaFill = document.getElementById("apiQuotaFill");

    if (!quotaContainer || !quotaText || !quotaFill) return;

    const usageMonthly = this.#getApiUsageMonthlyLimit();

    quotaContainer.classList.add("is-visible");
    quotaText.textContent = `${usage} / ${usageMonthly}`;
    quotaFill.style.width = `${Math.min((usage / usageMonthly) * 100, 100)}%`;
  }

  #getApiUsageMonthlyLimit() {
    const monthlyLimit = this.#youtubeService?.getApiUsageMonthlyLimit?.();
    if (Number.isFinite(monthlyLimit) && monthlyLimit > 0) return monthlyLimit;
    return 300;
  }
}
