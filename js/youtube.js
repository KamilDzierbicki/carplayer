import RapidApiYouTubeClient from "./youtube-api-rapidapi.js";
import VideoTileRenderer from "./video-tile-renderer.js";

export default class YouTubeService {
  #app;
  #storage;
  #dom;
  #apiClient;
  #settingsController = null;

  constructor(app, storage, apiClient = new RapidApiYouTubeClient()) {
    this.#app = app;
    this.#storage = storage;
    this.#dom = app.dom;
    this.#apiClient = apiClient;

    if (!this.#hasValidClientContract(apiClient)) {
      throw new Error("Invalid YouTube API client: missing normalized interface methods.");
    }
  }

  setSettingsController(settingsController) {
    this.#settingsController = settingsController;
  }

  getApiUsageMonthlyLimit() {
    if (!this.#apiClient?.getApiUsageMonthlyLimit) return 0;
    return this.#apiClient.getApiUsageMonthlyLimit();
  }

  async search(query) {
    const historyTitle = document.getElementById("historyTitle");
    const clearHistoryButton = document.getElementById("btnClearHistory");
    if (historyTitle) historyTitle.textContent = "Found on YouTube";
    if (clearHistoryButton) clearHistoryButton.classList.add("hidden");

    const apiKey = this.#storage.getApiKey();
    if (!apiKey) {
      alert("Please add your RapidAPI Key in Settings first.");
      this.#settingsController?.openModal();
      return;
    }

    const container = document.getElementById("historyItems");
    if (!container) return;

    container.innerHTML =
      '<div class="text-empty-state"><div class="loader loader-inline"></div><div class="loader-text">Searching YouTube...</div></div>';

    try {
      this.#storage.incrementApiQuota();
      const result = await this.#apiClient.searchVideos(query, apiKey);
      if (!result?.videos || result.videos.length === 0) {
        container.innerHTML = '<div class="text-empty-state">No results found.</div>';
        return;
      }

      container.innerHTML = "";
      result.videos.forEach((item) => {
        const tile = VideoTileRenderer.createYouTubeSearchTile({
          id: item.id,
          title: item.title,
          durationText: item.durationText,
          thumbnailUrl: item.thumbnailUrl,
          channelName: item.channelName,
          viewCountText: item.viewCountText,
        });

        container.appendChild(tile);
      });
    } catch (error) {
      console.error(error);
      container.innerHTML = `<div class="text-error-state">Error: ${error.message}</div>`;
    }
  }

  async load(videoId, providedTitle = "") {
    const apiKey = this.#storage.getApiKey();
    if (!apiKey) {
      alert("Please add your RapidAPI Key in Settings first.");
      this.#settingsController?.openModal();
      return;
    }

    const {
      setupScreen,
      playerScreen,
      loader,
      video,
      qualitySelect,
      speedSelect,
      volumeSlider,
      videoTitleOverlay,
    } = this.#dom;

    this.#app.clearBufferVisuals();

    setupScreen.classList.add("hidden");
    playerScreen.classList.add("active");
    loader.classList.add("is-visible");

    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    this.#app.state.currentVideoUrl = ytUrl;
    this.#storage.addHistory(videoId, providedTitle);

    video.playbackRate = this.#storage.getSpeed();
    speedSelect.value = this.#storage.getSpeed();
    video.volume = this.#storage.getVolume();
    volumeSlider.value = this.#storage.getVolume();

    if (videoTitleOverlay) {
      videoTitleOverlay.textContent = providedTitle || "YouTube Video";
    }

    video.removeAttribute("src");
    video.load();

    try {
      this.#storage.incrementApiQuota();
      const videoDetails = await this.#apiClient.getVideoDetails(videoId, apiKey);

      if (videoDetails.title) {
        this.#storage.updateHistoryItem(ytUrl, { title: videoDetails.title });
        if (videoTitleOverlay && videoTitleOverlay.textContent === "YouTube Video") {
          videoTitleOverlay.textContent = videoDetails.title;
        }
      }

      const availableQualities = this.#buildAvailableQualities(videoDetails.streams);
      if (availableQualities.length === 0) {
        throw new Error("No playable combined audio+video MP4 streams found (e.g. 360p/720p).");
      }

      const bestStream = this.#selectBestStream(videoDetails.streams);
      const streamUrl = bestStream?.url || availableQualities[0]?.url || "";
      if (!streamUrl) throw new Error("No stream URL in API response.");

      qualitySelect.innerHTML = "";
      availableQualities.forEach((quality) => {
        const option = document.createElement("option");
        option.value = quality.url;
        option.textContent = quality.label;
        if (quality.url === streamUrl) option.selected = true;
        qualitySelect.appendChild(option);
      });

      qualitySelect.classList.remove("hidden");

      video.src = streamUrl;
      video.load();
    } catch (error) {
      console.error("YouTube Fetch Error", error);
      alert("Error loading YouTube video: " + error.message);
      setupScreen.classList.remove("hidden");
      playerScreen.classList.remove("active");
      loader.classList.remove("is-visible");
    }
  }

  #hasValidClientContract(client) {
    return (
      client
      && typeof client.searchVideos === "function"
      && typeof client.getVideoDetails === "function"
      && typeof client.getApiUsageMonthlyLimit === "function"
    );
  }

  #selectBestStream(streams) {
    if (!Array.isArray(streams) || streams.length === 0) return null;

    const muxedStreams = streams.filter((stream) => stream.url && stream.hasAudio && stream.hasVideo);

    const preferred360 = muxedStreams.find((stream) => stream.itag === 18);
    if (preferred360) return preferred360;

    const audioVideoStreams = muxedStreams
      .sort((a, b) => (b.height || 0) - (a.height || 0));
    if (audioVideoStreams.length > 0) return audioVideoStreams[0];

    return null;
  }

  #buildAvailableQualities(streams) {
    if (!Array.isArray(streams) || streams.length === 0) return [];

    const source = streams.filter((stream) => stream.url && stream.hasAudio && stream.hasVideo);

    const unique = [];
    const seen = new Set();

    source.forEach((stream) => {
      const label = this.#resolveQualityLabel(stream);
      if (!label) return;
      if (seen.has(label)) return;
      seen.add(label);
      unique.push({
        url: stream.url,
        label,
        height: stream.height || 0,
        itag: stream.itag || 0,
      });
    });

    return unique.sort((a, b) => a.height - b.height);
  }

  #resolveQualityLabel(stream) {
    if (Number.isFinite(stream?.height) && stream.height > 0) {
      return `${stream.height}p`;
    }

    const qualityText = String(stream?.qualityLabel || "");
    const match = qualityText.match(/(\d{3,4})p/i);
    if (match && match[1]) {
      return `${match[1]}p`;
    }

    return null;
  }
}
