export default class ShareController {
  #app;
  #storage;
  #playerController = null;
  #shareSuccessTimeout = null;
  #shareDefaultLabel =
    '<span class="icon icon--sm icon-mask icon-mask--share" aria-hidden="true"></span> Send to Car';
  #shareSuccessLabel =
    '<span class="icon icon--sm icon-mask icon-mask--check" aria-hidden="true"></span> Sent';

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

    const currentUrlObj = new URL(window.location.href);
    currentUrlObj.searchParams.delete("share");
    currentUrlObj.searchParams.set("url", videoUrl);
    const shareUrl = currentUrlObj.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Play Video in Car",
          text: "Send this to the Car app to play on the vehicle screen.",
          url: shareUrl,
        });
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
        console.error("Share failed", error);
      }
    }

    this.#app.fallbackCopyText(shareUrl);
  }

  #handleDomReady() {
    this.#initShareFlow();
    this.#bindShareButtons();
    this.#handleInitialParams();
  }

  #initShareFlow() {
    const currentUrlObj = new URL(window.location.href);
    currentUrlObj.searchParams.delete("url");
    currentUrlObj.searchParams.set("share", "1");
    const baseUrl = currentUrlObj.href;

    const qrContainer = document.getElementById("qrcode");
    if (!qrContainer) return;

    qrContainer.innerHTML = "";
    new QRCode(qrContainer, {
      text: baseUrl,
      width: 250,
      height: 250,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H,
    });
  }

  #bindShareButtons() {
    const btnShareApiFlow = document.getElementById("btnShareApiFlow");
    if (btnShareApiFlow) {
      btnShareApiFlow.addEventListener("click", async () => {
        const mobileApiInput = document.getElementById("mobileApiInput");
        if (!mobileApiInput) return;

        const key = mobileApiInput.value.trim();
        if (!key) {
          alert("Please paste an API Key first.");
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

        const currentUrlObj = new URL(window.location.href);
        currentUrlObj.searchParams.delete("share");
        currentUrlObj.searchParams.set("url", videoUrl);
        const shareUrl = currentUrlObj.href;

        if (navigator.share) {
          try {
            await navigator.share({
              title: "Play Video in Car",
              text: "Send this to the Car app to play on the vehicle screen.",
              url: shareUrl,
            });

            this.#setShareFlowButtonState(btnShareFlow, true);

            clearTimeout(this.#shareSuccessTimeout);
            this.#shareSuccessTimeout = setTimeout(() => {
              this.#setShareFlowButtonState(btnShareFlow, false);
            }, 3000);
            return;
          } catch (error) {
            if (error.name !== "AbortError") {
              console.error("Share failed", error);
            }
          }
        }

        this.#app.fallbackCopyText(shareUrl);
      });
    }
  }

  #handleInitialParams() {
    const params = new URLSearchParams(window.location.search);
    const autoUrl = params.get("url");
    const apiKey = params.get("apikey");

    if (apiKey) {
      this.#storage.saveApiKey(apiKey);
      alert("API Key saved successfully!");
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
    }
  }

  #setShareFlowButtonState(button, success) {
    if (!button) return;
    button.innerHTML = success ? this.#shareSuccessLabel : this.#shareDefaultLabel;
    button.classList.toggle("success", success);
  }
}
