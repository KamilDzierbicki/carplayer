export default class CarPlayerCore {
  #dom;
  #state;
  #youtubeRegex;

  constructor() {
    this.#dom = {
      setupScreen: document.getElementById("setupScreen"),
      playerScreen: document.getElementById("playerScreen"),
      urlInput: document.getElementById("videoUrl"),
      searchInput: document.getElementById("searchInput"),
      btnLoad: document.getElementById("btnLoad"),
      loader: document.getElementById("loader"),
      canvas: document.getElementById("videoCanvas"),
      controls: document.getElementById("controls"),
      playPauseBtn: document.getElementById("playPauseBtn"),
      iconPlay: document.getElementById("iconPlay"),
      iconPause: document.getElementById("iconPause"),
      skipBackBtn: document.getElementById("skipBackBtn"),
      skipFwdBtn: document.getElementById("skipFwdBtn"),
      currentTimeEl: document.getElementById("currentTime"),
      durationEl: document.getElementById("duration"),
      progressWrapper: document.getElementById("progressWrapper"),
      progressBufferLayer: document.getElementById("progressBufferLayer"),
      progressFill: document.getElementById("progressFill"),
      volumeSlider: document.getElementById("volumeSlider"),
      muteBtn: document.getElementById("muteBtn"),
      speedSelectWrapper: document.getElementById("speedSelectWrapper"),
      speedSelectTrigger: document.getElementById("speedSelectTrigger"),
      speedSelectValue: document.getElementById("speedSelectValue"),
      speedSelectOptions: document.getElementById("speedSelectOptions"),
      qualitySelectWrapper: document.getElementById("qualitySelectWrapper"),
      qualitySelectTrigger: document.getElementById("qualitySelectTrigger"),
      qualitySelectValue: document.getElementById("qualitySelectValue"),
      qualitySelectOptions: document.getElementById("qualitySelectOptions"),
      audioTrackSelectWrapper: document.getElementById("audioTrackSelectWrapper"),
      audioTrackSelectTrigger: document.getElementById("audioTrackSelectTrigger"),
      audioTrackSelectValue: document.getElementById("audioTrackSelectValue"),
      audioTrackSelectOptions: document.getElementById("audioTrackSelectOptions"),
      captionSelectWrapper: document.getElementById("captionSelectWrapper"),
      captionSelectTrigger: document.getElementById("captionSelectTrigger"),
      captionSelectValue: document.getElementById("captionSelectValue"),
      captionSelectOptions: document.getElementById("captionSelectOptions"),
      captionOverlay: document.getElementById("captionOverlay"),
      historyItems: document.getElementById("historyItems"),
      topBar: document.getElementById("topBar"),
      btnBack: document.getElementById("btnBack"),
      skipIndicator: document.getElementById("skipIndicator"),
      videoTitleOverlay: document.getElementById("videoTitleOverlay"),
    };

    this.#dom.ctx = this.#dom.canvas
      ? this.#dom.canvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
      })
      : null;

    this.#state = {
      controlTimeout: null,
      isDragging: false,
      animationFrameId: null,
      currentVideoUrl: "",
      skipTimeout: null,
      clickTimeout: null,
    };

    this.#youtubeRegex =
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  }

  get dom() {
    return this.#dom;
  }

  get state() {
    return this.#state;
  }

  get youtubeRegex() {
    return this.#youtubeRegex;
  }

  openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add("active");
  }

  closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove("active");
  }

  openUrlModal() {
    if (this.#dom.urlInput) this.#dom.urlInput.value = "";

    const clearVideoUrlBtn = document.getElementById("clearVideoUrlBtn");
    if (clearVideoUrlBtn) clearVideoUrlBtn.classList.remove("is-visible");

    if (this.#dom.btnLoad) {
      this.#dom.btnLoad.classList.add("is-disabled");
    }

    this.openModal("urlModal");
  }

  formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return "00:00";
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  clearBufferVisuals() {
    if (this.#dom.progressBufferLayer) {
      this.#dom.progressBufferLayer.replaceChildren();
      return;
    }
    document.querySelectorAll(".progress-buffer-segment").forEach((el) => el.remove());
  }

  getVideoTitleFromUrl(url) {
    let filename = url;
    try {
      const parsed = new URL(url);
      const paths = parsed.pathname.split("/");
      const last = paths[paths.length - 1];
      if (last) filename = decodeURIComponent(last);
    } catch (error) {
      return filename;
    }
    return filename;
  }

  fallbackCopyText(text) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        alert(
          "Share not supported on this device. The URL has been copied to your clipboard!\\n\\nPaste it into a chat you have open on your phone or send it directly.",
        );
      })
      .catch((error) => {
        console.error("Copy failed", error);
        alert("Share not supported. Please copy this link manually:\\n\\n" + text);
      });
  }
}
