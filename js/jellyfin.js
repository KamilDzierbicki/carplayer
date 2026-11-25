export default class JellyfinService {
    #app;
    #storage;
    #settingsController = null;
    #playerController = null;

    constructor(app, storage) {
        this.#app = app;
        this.#storage = storage;
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
            alert("Please connect your Jellyfin server first.");
            // The server, codec and buffer are set up in the Jellyfin tab.
            document.dispatchEvent(new CustomEvent("request-tab", { detail: { tab: "jellyfin" } }));
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

    /**
     * Client + user id for per-user library views (latest, resume, favorites).
     * An API key is not tied to a user, so the first administrator (or first user) is picked once and stored.
     * @returns {Promise<{jf: Jellyfin, userId: string}|null>}
     */
    async getLibraryClient() {
        const serverUrl = this.#storage.getJellyfinServerUrl();
        const apiKey = this.#storage.getJellyfinApiKey();
        if (!serverUrl || !apiKey) return null;

        const jf = new Jellyfin(serverUrl, apiKey);
        let userId = this.#storage.getJellyfinUserId();
        if (!userId) {
            const users = await jf.listUsers();
            const user = users.find((entry) => entry?.Policy?.IsAdministrator) || users[0];
            if (!user?.Id) throw new Error("No Jellyfin user found for this API key.");
            userId = user.Id;
            this.#storage.saveJellyfinUserId(userId);
        }
        return { jf, userId };
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
                thumb: `${this.#baseUrl}/Items/${encodeURIComponent(item.Id)}/Images/Primary?ApiKey=${encodeURIComponent(this.#apiKey)}`
            }))
            .sort((a, b) => (b.dateCreated || "").localeCompare(a.dateCreated || ""));
        return items;
    }
    async listUsers() {
        const users = await this.#fetchApi(`/Users`);
        return Array.isArray(users) ? users : [];
    }
    async getLatestItems(userId, includeItemTypes, limit = 16) {
        const params = new URLSearchParams({ IncludeItemTypes: includeItemTypes, Limit: limit, GroupItems: "false", Fields: "DateCreated" });
        const items = await this.#fetchApi(`/Users/${userId}/Items/Latest?${params.toString()}`);
        return (Array.isArray(items) ? items : []).map((item) => this.#toLibraryItem(item));
    }
    async getResumeItems(userId, limit = 16) {
        const params = new URLSearchParams({ Limit: limit, MediaTypes: "Video", Recursive: "true" });
        const data = await this.#fetchApi(`/Users/${userId}/Items/Resume?${params.toString()}`);
        return (data.Items || []).map((item) => this.#toLibraryItem(item));
    }
    async getFavoriteItems(userId, limit = 24) {
        const params = new URLSearchParams({
            Filters: "IsFavorite", Recursive: "true", IncludeItemTypes: "Movie,Episode,Video",
            SortBy: "DateCreated", SortOrder: "Descending", Limit: limit,
        });
        const data = await this.#fetchApi(`/Users/${userId}/Items?${params.toString()}`);
        return (data.Items || []).map((item) => this.#toLibraryItem(item));
    }
    #toLibraryItem(item) {
        const episodeLabel = item.Type === "Episode" && item.SeriesName
            ? `${item.SeriesName} S${String(item.ParentIndexNumber || 0).padStart(2, "0")}E${String(item.IndexNumber || 0).padStart(2, "0")}`
            : "";
        return {
            id: item.Id,
            name: episodeLabel ? `${episodeLabel} - ${item.Name}` : item.Name,
            year: item.ProductionYear,
            type: item.Type,
            thumb: `${this.#baseUrl}/Items/${encodeURIComponent(item.Id)}/Images/Primary?ApiKey=${encodeURIComponent(this.#apiKey)}&maxWidth=480`,
        };
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
            AudioChannels: 2, // force to 2.0 for slower cpu in car
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
