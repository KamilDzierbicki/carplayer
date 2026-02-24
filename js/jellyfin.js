import VideoTileRenderer from "./video-tile-renderer.js";

export default class JellyfinService {
    #app;
    #storage;
    #settingsController = null;
    #playerController = null;

    constructor(app, storage) {
        this.#app = app;
        this.#storage = storage;

        this.#bindEvents();
    }

    setSettingsController(settingsController) {
        this.#settingsController = settingsController;
    }

    setPlayerController(playerController) {
        this.#playerController = playerController;
    }

    async load(itemId, title, serverBaseUrl) {
        if (!this.#playerController) return;

        let targetServer = (serverBaseUrl || "").trim();
        if (!targetServer) {
            targetServer = this.#storage.getJellyfinServerUrl();
        }

        if (!targetServer || !this.#storage.getJellyfinApiKey()) {
            alert("Please configure your Jellyfin settings first.");
            this.#settingsController?.openModal();
            return;
        }

        const jf = new Jellyfin(targetServer, this.#storage.getJellyfinApiKey());
        const qualityStr = this.#storage.getPreferredQualityId() || "360";

        const sessionUrl = JellyfinService.buildBrowserItemUrl(targetServer, itemId);
        this.#app.dom.urlInput.value = sessionUrl;

        if (title) {
            this.#storage.addHistory(sessionUrl, title);
        }

        // The player controller will handle loading the Adapter and rendering
        await this.#playerController.loadJellyfinItem(jf, itemId, title, sessionUrl, qualityStr);
    }

    static parseSessionUrl(url) {
        const raw = String(url || "").trim();
        if (raw.startsWith("jellyfin-item://")) {
            try {
                const parsed = new URL(raw);
                const itemId = parsed.hostname || parsed.pathname.replace(/^\/+/, "");
                const serverBaseUrl = parsed.searchParams.get("server") || "";
                return { itemId, serverBaseUrl };
            } catch {
                return null;
            }
        }

        if (raw.startsWith("jellyfin://")) {
            try {
                const parsed = new URL(raw);
                // Safari parses custom URLs differently than Chrome
                // pathname might be "//movies.oxyconit.com/item/1234"
                const match = parsed.pathname.match(/\/item\/([^\/]+)/);
                const itemId = match ? match[1] : "";
                const host = parsed.host || parsed.hostname || (parsed.pathname.split('/')[2] || "");
                return { itemId, serverBaseUrl: `https://${host}` };
            } catch {
                return null;
            }
        }

        return null;
    }

    static buildBrowserItemUrl(serverBaseUrl, itemId) {
        if (!itemId) return "";
        let base = "jellyfin-item://";
        base += itemId;
        if (serverBaseUrl) {
            base += `?server=${encodeURIComponent(serverBaseUrl)}`;
        }
        return base;
    }

    #bindEvents() {
        const searchForm = document.querySelector(".search-bar__form");
        const searchInput = document.getElementById("searchInput");
        const searchClear = document.getElementById("clearSearchBtn");

        if (searchForm) {
            searchForm.addEventListener("submit", (e) => {
                e.preventDefault();
                this.#handleSearch(searchInput?.value);
            });
        }

        if (searchClear && searchInput) {
            searchInput.addEventListener("input", () => {
                searchClear.classList.toggle("is-visible", searchInput.value.length > 0);
                if (searchInput.value.length === 0) {
                    const historyTitleElement = document.getElementById("historyTitle");
                    if (historyTitleElement) historyTitleElement.textContent = "Recently Played";
                    this.#app.dom.historyItems.innerHTML = "";
                    this.#storage.renderHistory();
                }
            });

            searchClear.addEventListener("click", () => {
                const historyTitleElement = document.getElementById("historyTitle");
                if (historyTitleElement) historyTitleElement.textContent = "Recently Played";

                searchInput.value = "";
                searchClear.classList.remove("is-visible");
                searchInput.focus();
                this.#app.dom.historyItems.innerHTML = "";
                this.#storage.renderHistory();
            });
        }
    }

    #clearSearch() {
        const searchInput = document.getElementById("searchInput");
        const searchClear = document.getElementById("clearSearchBtn");
        const historyTitleElement = document.getElementById("historyTitle");

        if (searchInput) searchInput.value = "";
        if (searchClear) searchClear.classList.remove("is-visible");
        if (historyTitleElement) historyTitleElement.textContent = "Recently Played";
        if (this.#app.dom.historyItems) this.#app.dom.historyItems.innerHTML = "";
        this.#storage.renderHistory();
    }

    async #handleSearch(query) {
        const term = String(query || "").trim();
        if (!term) return;

        const serverUrl = this.#storage.getJellyfinServerUrl();
        const apiKey = this.#storage.getJellyfinApiKey();

        if (!serverUrl || !apiKey) {
            alert("Please configure Jellyfin settings before searching.");
            this.#settingsController?.openModal();
            return;
        }

        const HistoryRenderer = this.#app.dom.historyItems;
        if (HistoryRenderer) {
            HistoryRenderer.innerHTML = '<div class="loader is-visible" aria-hidden="true" style="margin: 20px auto;"></div>';
            const historyTitleElement = document.getElementById("historyTitle");
            if (historyTitleElement) {
                historyTitleElement.innerHTML = `<button class="btn-back-search" id="btnBackFromSearch" type="button" title="Back to Recently Played"><span class="icon icon--sm icon-mask icon-mask--back" aria-hidden="true"></span></button> Search Results`;
                const backBtn = document.getElementById("btnBackFromSearch");
                if (backBtn) {
                    backBtn.addEventListener("click", () => this.#clearSearch());
                }
            }

            const clearHistoryButton = document.getElementById("btnClearHistory");
            if (clearHistoryButton) clearHistoryButton.classList.add("hidden");
        }

        try {
            const jf = new Jellyfin(serverUrl, apiKey);
            const results = await jf.search(term);

            if (HistoryRenderer) {
                HistoryRenderer.innerHTML = "";
            }

            if (!results || results.length === 0) {
                if (HistoryRenderer) {
                    HistoryRenderer.innerHTML = `<div class="text-empty-state">No results found for "${term}".</div>`;
                }
                return;
            }

            if (HistoryRenderer) {
                results.forEach(item => {
                    const tile = VideoTileRenderer.createJellyfinSearchTile({
                        id: item.id,
                        title: item.name,
                        thumbnailUrl: item.thumb,
                        typeText: item.type,
                        year: item.year,
                        serverBaseUrl: serverUrl
                    });
                    HistoryRenderer.appendChild(tile);
                });
            }
        } catch (error) {
            console.error("Jellyfin search error:", error);
            if (HistoryRenderer) {
                HistoryRenderer.innerHTML = `<div class="text-empty-state">Search failed: ${error.message}</div>`;
            }
        }
    }
}

// Ensure the HLS bitrates match x5.html
export const HLS_BITRATES = { 360: 1000000, 480: 2500000, 720: 5000000, 1080: 8000000 };

export class Jellyfin {
    #baseUrl; #apiKey; #authHeaderValue;
    constructor(baseUrl, apiKey, clientName = "CanvasPlayer", deviceName = "Web", deviceId = "js-123") {
        this.#baseUrl = baseUrl.replace(/\/$/, ""); this.#apiKey = apiKey;
        this.#authHeaderValue = `MediaBrowser Token="${this.#apiKey}", Client="${clientName}", Device="${deviceName}", DeviceId="${deviceId}", Version="1.0.0"`;
    }
    get baseUrl() { return this.#baseUrl; }
    get apiKey() { return this.#apiKey; }
    async #fetchApi(endpoint, options = {}) {
        const url = new URL(`${this.#baseUrl}${endpoint}`);
        const response = await fetch(url.toString(), { ...options, headers: { 'Authorization': this.#authHeaderValue, 'Content-Type': 'application/json', ...(options.headers || {}) } });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        return response.json();
    }
    async fetchRaw(url, options = {}) {
        return fetch(url, { ...options, headers: { 'Authorization': this.#authHeaderValue, ...(options.headers || {}) } });
    }
    async search(searchTerm) {
        const params = new URLSearchParams({
            searchTerm: searchTerm,
            includeItemTypes: "Movie,Episode",
            recursive: true,
            fields: "PrimaryImageAspectRatio,DateCreated",
        });
        const data = await this.#fetchApi(`/Items?${params.toString()}`);
        const items = data.Items
            .map(item => ({
                id: item.Id, name: item.Name, year: item.ProductionYear, type: item.Type,
                dateCreated: item.DateCreated || "",
                thumb: `${this.#baseUrl}/Items/${item.Id}/Images/Primary?ApiKey=${this.#apiKey}`
            }))
            .sort((a, b) => (b.dateCreated || "").localeCompare(a.dateCreated || ""));
        return items;
    }
    async getPlaybackInfo(itemId, options = {}) {
        const { startSeconds = 0, audioIndex = null, subIndex = null, mediaSourceId = null } = options;
        const qp = new URLSearchParams();
        qp.set('startTimeTicks', Math.floor(startSeconds * 10000000));
        qp.set('enableDirectPlay', 'true');
        qp.set('enableDirectStream', 'true');
        qp.set('enableTranscoding', 'true');
        qp.set('autoOpenLiveStream', 'true');
        qp.set('maxStreamingBitrate', '120000000');
        if (audioIndex !== null) qp.set('audioStreamIndex', audioIndex);
        if (subIndex !== null) qp.set('subtitleStreamIndex', subIndex);
        if (mediaSourceId !== null) qp.set('mediaSourceId', mediaSourceId);
        // Note: DeviceProfile in body causes 400 on some Jellyfin versions, so we send empty body
        const data = await this.#fetchApi(`/Items/${itemId}/PlaybackInfo?${qp.toString()}`, { method: 'POST', body: JSON.stringify({}) });
        if (!data.MediaSources || data.MediaSources.length === 0) throw new Error("No media sources.");
        const mediaSource = data.MediaSources[0];
        return {
            mediaSourceId: mediaSource.Id,
            container: mediaSource.Container,
            runTimeTicks: mediaSource.RunTimeTicks,
            transcodingUrl: mediaSource.TranscodingUrl,
            supportsDirectStream: mediaSource.SupportsDirectStream,
            supportsDirectPlay: mediaSource.SupportsDirectPlay,
            playSessionId: data.PlaySessionId,
            streams: mediaSource.MediaStreams.map(s => ({ index: s.Index, type: s.Type, language: s.Language, codec: s.Codec, title: s.DisplayTitle }))
        };
    }
    getDirectPlayUrl(itemId, { mediaSourceId = null, audioIndex = null } = {}) {
        const params = new URLSearchParams({ ApiKey: this.#apiKey, startTimeTicks: 0, Static: 'true' });
        if (mediaSourceId) params.append('MediaSourceId', mediaSourceId);
        if (audioIndex !== null) params.append('AudioStreamIndex', audioIndex);
        return `${this.#baseUrl}/Videos/${itemId}/stream?${params.toString()}`;
    }
    getHlsUrl(itemId, options = {}) {
        const { mediaSourceId = null, height = 1080, startSeconds = 0, audioIndex = null, playSessionId = null } = options;
        const roundedTicks = Math.floor(startSeconds * 10000000);
        const videoBitrate = HLS_BITRATES[height] || 8000000;
        const audioBitrate = 192000;
        const params = new URLSearchParams({
            ApiKey: this.#apiKey,
            startTimeTicks: roundedTicks,
            VideoCodec: options.videoCodec || 'h264',
            AudioCodec: 'aac',
            maxHeight: height,
            maxWidth: Math.round(height * 16 / 9),
            VideoBitrate: videoBitrate,
            AudioBitrate: audioBitrate,
            MaxStreamingBitrate: videoBitrate + audioBitrate,
            TranscodeReasons: 'VideoCodecNotSupported,AudioCodecNotSupported,ContainerNotSupported',
            SegmentContainer: 'ts',
            MinSegments: 1,
            BreakOnNonKeyFrames: true,
            ManifestName: 'main'
        });
        if (mediaSourceId) params.append('MediaSourceId', mediaSourceId);
        if (audioIndex !== null) params.append('AudioStreamIndex', audioIndex);
        if (playSessionId) params.append('PlaySessionId', playSessionId);

        return `${this.#baseUrl}/Videos/${itemId}/master.m3u8?${params.toString()}`;
    }
    getSubtitleUrl(itemId, mediaSourceId, subtitleIndex) {
        return `${this.#baseUrl}/Videos/${itemId}/${mediaSourceId}/Subtitles/${subtitleIndex}/Stream.vtt?ApiKey=${this.#apiKey}`;
    }
    async stopActiveEncodings(playSessionId) {
        try {
            const url = `${this.#baseUrl}/Videos/ActiveEncodings?DeviceId=js-123` + (playSessionId ? `&PlaySessionId=${playSessionId}` : '');
            await fetch(url, { method: 'DELETE', headers: { 'Authorization': this.#authHeaderValue } });
            console.log(`[Jellyfin] Stopped active encodings. playSessionId: ${playSessionId || 'all'}`);
        } catch (e) {
            console.warn(`[Jellyfin] Failed to stop active encodings:`, e);
        }
    }
}
