export default class CarPlayerCore {
  #dom;
  #state;
  #youtubeRegex;

  constructor() {
    const mediaView = document.getElementById("mediaView");

    this.#dom = {
      setupScreen: document.getElementById("setupScreen"),
      playerScreen: document.getElementById("playerScreen"),
      urlInput: document.getElementById("videoUrl"),
      searchInput: document.getElementById("searchInput"),
      btnLoad: document.getElementById("btnLoad"),
      loader: mediaView ? mediaView.loader : null,
      videoControls: document.getElementById("videoControls"),
      canvas: mediaView ? mediaView.canvas : null,
      captionOverlay: mediaView ? mediaView.captionOverlay : null,
      historyComponent: document.getElementById("historyComponent"),
      jellyfinSearchComponent: document.getElementById("jellyfinSearchComponent"),
      topBar: document.getElementById("topBar"),
      btnBack: document.getElementById("btnBack"),
      skipIndicator: mediaView ? mediaView.skipIndicator : null,
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
    if (!modal) return;
    if (typeof modal.open === 'function') {
      modal.open();
    } else {
      modal.classList.add("active");
      modal.dispatchEvent(new CustomEvent('modal-open', { bubbles: true }));
    }
  }

  closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    if (typeof modal.close === 'function') {
      modal.close();
    } else {
      modal.classList.remove("active");
      modal.dispatchEvent(new CustomEvent('modal-close', { bubbles: true }));
    }
  }

  openUrlModal() {
    // Reset the clearable-input component
    const urlInput = document.getElementById("videoUrl");
    if (urlInput) urlInput.value = "";

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
