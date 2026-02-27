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
        const appNav = document.querySelector("carplayer-navbar");
        if (appNav) {
            appNav.addEventListener("search", (e) => {
                const term = e.detail;
                if (!term) {
                    const historyTitleElement = document.getElementById("historyTitle");
                    if (historyTitleElement) historyTitleElement.textContent = "Recently Played";
                    if (this.#app.dom.historyComponent) {
                        this.#app.dom.historyComponent.searchQuery = "";
                    }
                    this.#storage.renderHistory();
                } else {
                    this.#handleSearch(term);
                }
            });
        }
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

        const historyComponent = this.#app.dom.historyComponent;
        const searchComponent = this.#app.dom.jellyfinSearchComponent;

        if (historyComponent && searchComponent) {
            historyComponent.classList.add("hidden");
            searchComponent.classList.remove("hidden");

            searchComponent.setAttribute("server-url", serverUrl);
            searchComponent.setAttribute("api-key", apiKey);
            searchComponent.setAttribute("query", term);

            // Listen for back event if not already listening
            if (!searchComponent._backListenerAttached) {
                searchComponent.addEventListener("back", () => this.#clearSearch());
                searchComponent._backListenerAttached = true;
            }
        }
    }

    #clearSearch() {
        const appNav = document.querySelector("carplayer-navbar");
        if (appNav) appNav.clearSearch();

        const historyComponent = this.#app.dom.historyComponent;
        const searchComponent = this.#app.dom.jellyfinSearchComponent;

        if (historyComponent && searchComponent) {
            searchComponent.classList.add("hidden");
            searchComponent.removeAttribute("query");
            historyComponent.classList.remove("hidden");
        }

        this.#storage.renderHistory();
    }
}

export const HLS_BITRATES = { 360: 1000000, 480: 2500000, 720: 5000000, 1080: 8000000 };

export class Jellyfin {
    #baseUrl; #apiKey; #authHeaderValue;
    constructor(baseUrl, apiKey, clientName = "CarPlayer", deviceName = "Web", deviceId = "js-123") {
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
            includeItemTypes: "Movie,Episode,Video",
            mediaTypes: "Video",
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
