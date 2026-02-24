export default class PlayerController {
  #app;
  #storage;
  #dom;
  #state;
  #youtubeService = null;
  #historyRenderer = null;

  constructor(app, storage) {
    this.#app = app;
    this.#storage = storage;
    this.#dom = app.dom;
    this.#state = app.state;

    this.#bindEvents();
  }

  setDependencies({ youtubeService, historyRenderer }) {
    if (youtubeService) this.#youtubeService = youtubeService;
    if (historyRenderer) this.#historyRenderer = historyRenderer;
  }

  loadVideo(url) {
    if (!url) {
      alert("Please enter a valid video URL.");
      return;
    }

    const {
      setupScreen,
      playerScreen,
      loader,
      video,
      speedSelect,
      volumeSlider,
      videoTitleOverlay,
      qualitySelect,
    } = this.#dom;

    this.#app.clearBufferVisuals();

    const ytMatch = url.match(this.#app.youtubeRegex);
    if (ytMatch && ytMatch[1]) {
      this.#youtubeService?.load(ytMatch[1]);
      return;
    }

    setupScreen.classList.add("hidden");
    playerScreen.classList.add("active");
    loader.classList.add("is-visible");

    this.#state.currentVideoUrl = url;
    this.#storage.addHistory(url);

    video.playbackRate = this.#storage.getSpeed();
    speedSelect.value = this.#storage.getSpeed();
    video.volume = this.#storage.getVolume();
    volumeSlider.value = this.#storage.getVolume();

    if (videoTitleOverlay) {
      videoTitleOverlay.textContent = this.#app.getVideoTitleFromUrl(url);
    }

    qualitySelect.innerHTML = `<option value="${url}" selected>Direct Link</option>`;
    qualitySelect.classList.remove("hidden");

    video.src = url;
    video.load();
  }

  #bindEvents() {
    const {
      playerScreen,
      video,
      playPauseBtn,
      canvas,
      progressWrapper,
      volumeSlider,
      muteBtn,
      speedSelect,
      qualitySelect,
      btnBack,
    } = this.#dom;

    playerScreen.addEventListener("mousemove", () => this.#showControls());
    playerScreen.addEventListener("touchstart", () => this.#showControls(), { passive: true });

    video.addEventListener("loadedmetadata", () => this.#handleLoadedMetadata());
    video.addEventListener("play", () => this.#handlePlay());
    video.addEventListener("pause", () => this.#handlePause());
    video.addEventListener("timeupdate", () => this.#handleTimeUpdate());
    video.addEventListener("error", (event) => this.#handleError(event));
    video.addEventListener("waiting", () => this.#handleWaiting());
    video.addEventListener("playing", () => this.#handlePlaying());

    playPauseBtn.addEventListener("click", () => this.#togglePlayPause());
    canvas.addEventListener("click", (event) => this.#handleCanvasClick(event));
    progressWrapper.addEventListener("click", (event) => this.#seekByProgressClick(event));

    volumeSlider.addEventListener("input", (event) => this.#handleVolumeInput(event));
    muteBtn.addEventListener("click", () => this.#toggleMute());
    speedSelect.addEventListener("change", (event) => this.#handleSpeedChange(event));
    qualitySelect.addEventListener("change", (event) => this.#handleQualityChange(event));

    btnBack.addEventListener("click", () => this.#handleBack());
  }

  #showControls() {
    const { controls, topBar, video } = this.#dom;

    controls.classList.remove("idle");
    topBar.classList.remove("idle");

    clearTimeout(this.#state.controlTimeout);
    this.#state.controlTimeout = setTimeout(() => {
      if (!video.paused && !this.#state.isDragging) {
        controls.classList.add("idle");
        topBar.classList.add("idle");
      }
    }, 3000);
  }

  #renderLoop() {
    const { video, ctx, canvas } = this.#dom;

    if (!video.paused && !video.ended && ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    if ("requestVideoFrameCallback" in video) {
      video.requestVideoFrameCallback(() => this.#renderLoop());
    } else {
      this.#state.animationFrameId = requestAnimationFrame(() => this.#renderLoop());
    }
  }

  #showSkipIndicator(seconds, side) {
    const { skipIndicator } = this.#dom;
    const backIcon =
      '<span class="skip-svg icon icon-mask icon-mask--skip-back" aria-hidden="true"></span>';
    const forwardIcon =
      '<span class="skip-svg icon icon-mask icon-mask--skip-forward" aria-hidden="true"></span>';

    if (side === "left") {
      skipIndicator.innerHTML = `${backIcon} <span>${seconds}s</span>`;
      skipIndicator.classList.add("skip-indicator--left");
      skipIndicator.classList.remove("skip-indicator--right");
    } else {
      skipIndicator.innerHTML = `<span>${seconds}s</span> ${forwardIcon}`;
      skipIndicator.classList.add("skip-indicator--right");
      skipIndicator.classList.remove("skip-indicator--left");
    }

    skipIndicator.classList.remove("show");
    void skipIndicator.offsetWidth;
    skipIndicator.classList.add("show");

    clearTimeout(this.#state.skipTimeout);
    this.#state.skipTimeout = setTimeout(() => {
      skipIndicator.classList.remove("show");
    }, 600);
  }

  #renderBuffer() {
    const { video } = this.#dom;
    const duration = video.duration;
    if (duration <= 0) return;

    for (let i = 0; i < video.buffered.length; i += 1) {
      const startX = (video.buffered.start(i) / duration) * 100;
      const endX = (video.buffered.end(i) / duration) * 100;
      const width = endX - startX;

      let bufferEl = document.getElementById(`buffer-${i}`);
      if (!bufferEl) {
        bufferEl = document.createElement("div");
        bufferEl.id = `buffer-${i}`;
        bufferEl.className = "progress-buffer-segment";
        const progressBarBg = document.querySelector(".progress-bar-bg");
        if (progressBarBg) progressBarBg.appendChild(bufferEl);
      }

      bufferEl.style.left = `${startX}%`;
      bufferEl.style.width = `${width}%`;
    }
  }

  #togglePlayPause() {
    const { video } = this.#dom;
    if (video.paused) video.play();
    else video.pause();
  }

  #handleCanvasClick(event) {
    const { canvas, video } = this.#dom;

    if (this.#state.clickTimeout) {
      clearTimeout(this.#state.clickTimeout);
      this.#state.clickTimeout = null;

      const rect = canvas.getBoundingClientRect();
      const clickX = event.clientX - rect.left;

      if (clickX < rect.width / 2) {
        video.currentTime = Math.max(0, video.currentTime - 10);
        this.#showSkipIndicator(10, "left");
      } else {
        video.currentTime = Math.min(video.duration, video.currentTime + 10);
        this.#showSkipIndicator(10, "right");
      }
      return;
    }

    this.#state.clickTimeout = setTimeout(() => {
      this.#togglePlayPause();
      this.#state.clickTimeout = null;
    }, 250);
  }

  #handleLoadedMetadata() {
    const { loader, durationEl, video, canvas } = this.#dom;

    loader.classList.remove("is-visible");
    durationEl.textContent = this.#app.formatTime(video.duration);

    const savedData = this.#storage.getPlaybackPos(this.#state.currentVideoUrl);
    const savedTime = savedData ? savedData.time : 0;
    if (savedTime > 0 && savedTime < video.duration) {
      video.currentTime = savedTime;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    video.play().catch((error) => {
      console.warn("Auto-play requires user interaction in this browser.", error);
    });
  }

  #handlePlay() {
    const { iconPlay, iconPause, video } = this.#dom;

    iconPlay.classList.add("hidden");
    iconPause.classList.remove("hidden");
    this.#showControls();

    if ("requestVideoFrameCallback" in video) {
      video.requestVideoFrameCallback(() => this.#renderLoop());
    } else {
      this.#renderLoop();
    }
  }

  #handlePause() {
    const { iconPlay, iconPause } = this.#dom;
    iconPlay.classList.remove("hidden");
    iconPause.classList.add("hidden");
    this.#showControls();
  }

  #handleTimeUpdate() {
    const { video, currentTimeEl, progressFill } = this.#dom;

    if (!this.#state.isDragging) {
      currentTimeEl.textContent = this.#app.formatTime(video.currentTime);
      const percent = (video.currentTime / video.duration) * 100 || 0;
      progressFill.style.width = `${percent}%`;
      this.#renderBuffer();
    }

    if (Math.floor(video.currentTime) % 5 === 0 && !video.paused) {
      this.#storage.savePlaybackPos(this.#state.currentVideoUrl, video.currentTime, video.duration);
    }
  }

  #seekByProgressClick(event) {
    const { progressWrapper, video, progressFill } = this.#dom;
    const rect = progressWrapper.getBoundingClientRect();
    const posX = event.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, posX / rect.width));

    video.currentTime = percentage * video.duration;
    progressFill.style.width = `${percentage * 100}%`;
  }

  #handleVolumeInput(event) {
    const { video } = this.#dom;
    const value = parseFloat(event.target.value);

    video.volume = value;
    video.muted = value === 0;
    this.#storage.saveVolume(value);
  }

  #toggleMute() {
    const { video, volumeSlider } = this.#dom;

    video.muted = !video.muted;
    if (video.muted) {
      volumeSlider.value = 0;
      return;
    }

    video.volume = this.#storage.getVolume() || 1;
    volumeSlider.value = video.volume;
  }

  #handleSpeedChange(event) {
    const { video } = this.#dom;
    const value = parseFloat(event.target.value);

    video.playbackRate = value;
    this.#storage.saveSpeed(value);
  }

  #handleQualityChange(event) {
    const { video } = this.#dom;
    const newUrl = event.target.value;
    const currentTime = video.currentTime;
    const isPaused = video.paused;
    const prevPlaybackRate = video.playbackRate;

    video.src = newUrl;
    video.load();

    video.addEventListener("loadedmetadata", function onLoaded() {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.currentTime = currentTime;
      video.playbackRate = prevPlaybackRate;

      if (!isPaused) {
        video.play().catch((error) => console.warn("Quality auto-play prevented", error));
      }
    });
  }

  #handleError(event) {
    const { loader, setupScreen, playerScreen } = this.#dom;

    loader.classList.remove("is-visible");
    console.error("Video Error", event);
    alert(
      "An error occurred while loading the video. Ensure the URL is correct and allows external loading (CORS/Not Found).",
    );
    setupScreen.classList.remove("hidden");
    playerScreen.classList.remove("active");
  }

  #handleWaiting() {
    this.#dom.loader.classList.add("is-visible");
  }

  #handlePlaying() {
    this.#dom.loader.classList.remove("is-visible");
  }

  #handleBack() {
    const { video, playerScreen, setupScreen } = this.#dom;

    video.pause();
    cancelAnimationFrame(this.#state.animationFrameId);

    this.#storage.savePlaybackPos(this.#state.currentVideoUrl, video.currentTime, video.duration);

    playerScreen.classList.remove("active");
    setupScreen.classList.remove("hidden");
    this.#historyRenderer?.render();
  }
}
