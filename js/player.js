import { ALL_FORMATS, AudioBufferSink, CanvasSink, Input, UrlSource, ReadableStreamSource, MPEG_TS } from 'https://cdn.jsdelivr.net/npm/mediabunny@1.34.5/+esm';
import { registerAc3Decoder } from 'https://cdn.jsdelivr.net/npm/@mediabunny/ac3@1.34.5/+esm';

// Register AC3 decoder to enable passthrough support for AC3 audio in Jellyfin HLS streams (which is common for Dolby Digital 5.1 tracks)
registerAc3Decoder();

const HLS_CACHE_SIZE = 256 * 1024 * 1024;
const SEGMENT_MAX_RETRIES = 5;
const SEGMENT_RETRY_BASE_MS = 1500;

// ── Utilities ──────────────────────────────────────────
const getTrackId = (track) => {
    const id = track?.id;
    if (id === null || id === undefined) return '';
    return String(id).trim();
};

export const formatSeconds = (seconds) => {
    const safe = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = Math.floor(safe % 60);
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${minutes}:${String(secs).padStart(2, '0')}`;
};

const canDecodeTrack = async (track) => {
    if (!track || track.codec === null || track.codec === undefined) return false;
    if (typeof track.canDecode !== 'function') return true;
    try { return Boolean(await track.canDecode()); } catch { return false; }
};

const filterDecodable = async (tracks) => {
    const result = [];
    for (const t of tracks) { if (await canDecodeTrack(t)) result.push(t); }
    return result;
};

const collectDeduped = (tracks) => {
    const deduped = [];
    const seen = new Set();
    for (const t of tracks) {
        if (!t) continue;
        const id = getTrackId(t);
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        deduped.push(t);
    }
    return deduped;
};

const toHttpUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try { const u = new URL(raw); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; }
    catch { return ''; }
};

class BaseSourceAdapter {
    constructor() { this.quality = 'direct'; }
    async init() { }
    getMediaUrl() { throw new Error('Not implemented'); }
    getSubtitleTracks() { return []; }
    async createInput() { throw new Error('Not implemented'); }
    async getDuration(input) { return await input.computeDuration(); }
    isSeekable() { return true; }
    setQuality(newQuality) { this.quality = newQuality; }
}

export class DirectMp4Adapter extends BaseSourceAdapter {
    constructor(url) { super(); this.url = url; }
    getMediaUrl() { return this.url; }
    async createInput() {
        return new Input({
            source: new UrlSource(this.url),
            formats: ALL_FORMATS,
        });
    }
}

export class JellyfinAdapter extends BaseSourceAdapter {
    constructor(jf, itemId, storage, quality = '360') {
        super(); this.jf = jf; this.itemId = itemId; this.storage = storage;
        this.quality = quality;
        this.startSeconds = 0;
        this._usedDirectPlay = false;
        this._lastPlaySessionId = null;
        this._audioIndex = null;
    }
    setQuality(newQuality) {
        this.quality = newQuality;
        this._hlsSegments = null;
        this._usedDirectPlay = false;
    }
    setAudioIndex(index) {
        this._audioIndex = index;
        this._hlsSegments = null;
        this._usedDirectPlay = false;
    }
    async init() {
        this.playbackInfo = await this.jf.getPlaybackInfo(this.itemId);
        this.mediaSourceId = this.playbackInfo.mediaSourceId;
    }
    getMediaUrl() {
        return this.jf.getDirectPlayUrl(this.itemId, { mediaSourceId: this.mediaSourceId });
    }
    async _stopPreviousSession() {
        if (this._lastPlaySessionId) {
            await this.jf.stopActiveEncodings(this._lastPlaySessionId);
            this._lastPlaySessionId = null;
        }
    }
    async createInput(startSeconds = 0) {
        this.startSeconds = startSeconds;
        return this.quality === 'direct'
            ? this._createDirectInput(startSeconds)
            : this._createHlsInput(startSeconds);
    }
    async _createDirectInput(startSeconds) {
        await this._stopPreviousSession();
        const pbInfo = await this.jf.getPlaybackInfo(this.itemId, { startSeconds, mediaSourceId: this.mediaSourceId });
        this._usedDirectPlay = true;
        this._hlsSegments = null;
        return new Input({
            source: new UrlSource(this.jf.getDirectPlayUrl(this.itemId, { mediaSourceId: pbInfo.mediaSourceId })),
            formats: ALL_FORMATS,
        });
    }
    async _createHlsInput(startSeconds) {
        this._usedDirectPlay = false;
        const height = parseInt(this.quality) || 1080;

        // Reuse cached HLS session if available
        if (this._hlsSegments?.length > 0 && startSeconds > 0) {
            const segDuration = this._hlsSegDuration || 3;
            const skipToIndex = Math.min(this._hlsSegments.length - 1, Math.max(0, Math.floor(startSeconds / segDuration)));
            return this._buildHlsInput(skipToIndex);
        }

        // New HLS session
        await this._stopPreviousSession();
        const pbInfo = await this.jf.getPlaybackInfo(this.itemId, { startSeconds: 0, mediaSourceId: this.mediaSourceId });
        this._lastPlaySessionId = pbInfo.playSessionId || null;

        const config = this.storage.getJellyfinConfig();

        let hlsMasterUrl = pbInfo.transcodingUrl
            || this.jf.getHlsUrl(this.itemId, { mediaSourceId: pbInfo.mediaSourceId, startSeconds: 0, height, playSessionId: pbInfo.playSessionId, audioIndex: this._audioIndex, videoCodec: config.videoCodec });
        if (hlsMasterUrl.startsWith('/')) hlsMasterUrl = this.jf.baseUrl + hlsMasterUrl;
        if (!hlsMasterUrl.includes('ApiKey=')) hlsMasterUrl += (hlsMasterUrl.includes('?') ? '&' : '?') + `ApiKey=${this.jf.apiKey}`;

        // Fetch master playlist and pick first variant
        const masterRes = await this.jf.fetchRaw(hlsMasterUrl);
        if (!masterRes.ok) throw new Error(`HLS Master Playlist failed: ${masterRes.status}`);
        const masterText = await masterRes.text();
        let playlistUrl = hlsMasterUrl;
        for (const line of masterText.split('\n').map(l => l.trim())) {
            if (line && !line.startsWith('#')) { playlistUrl = this._resolveUrl(line, hlsMasterUrl); break; }
        }

        // Fetch media playlist and cache segments
        const mediaRes = await this.jf.fetchRaw(playlistUrl);
        if (!mediaRes.ok) throw new Error(`HLS Media Playlist failed: ${mediaRes.status}`);
        const mediaText = await mediaRes.text();
        this._hlsSegments = [];
        this._hlsSegDuration = 3;
        for (const line of mediaText.split('\n').map(l => l.trim())) {
            if (line.startsWith('#EXT-X-TARGETDURATION:')) this._hlsSegDuration = parseFloat(line.split(':')[1]) || 3;
            else if (line && !line.startsWith('#')) this._hlsSegments.push(this._resolveUrl(line, playlistUrl));
        }

        const skipTo = startSeconds > 0 ? Math.min(this._hlsSegments.length - 1, Math.max(0, Math.floor(startSeconds / this._hlsSegDuration))) : 0;
        return this._buildHlsInput(skipTo);
    }
    _resolveUrl(relative, baseRef) {
        if (relative.startsWith('http')) return relative;
        const basePath = baseRef.split('?')[0];
        const base = basePath.substring(0, basePath.lastIndexOf('/') + 1);
        if (relative.includes('?')) return base + relative;
        const query = baseRef.includes('?') ? '?' + baseRef.split('?')[1] : '';
        return base + relative + query;
    }
    _buildHlsInput(startSegmentIndex = 0) {
        const segments = this._hlsSegments;
        let segmentIndex = startSegmentIndex;

        const stream = new ReadableStream({
            pull: async (controller) => {
                if (segmentIndex >= segments.length) { controller.close(); return; }
                const segUrl = segments[segmentIndex++];
                let res;
                for (let attempt = 0; attempt < SEGMENT_MAX_RETRIES; attempt++) {
                    res = await this.jf.fetchRaw(segUrl);
                    if (res.ok) break;
                    if ([400, 404, 500].includes(res.status)) {
                        const waitMs = SEGMENT_RETRY_BASE_MS + attempt * SEGMENT_RETRY_BASE_MS;
                        console.warn(`[HLS] Segment ${segmentIndex} not ready (${res.status}), retry ${attempt + 1}/${SEGMENT_MAX_RETRIES} in ${waitMs}ms`);
                        await new Promise(r => setTimeout(r, waitMs));
                    } else break;
                }
                if (!res.ok) { controller.error(new Error(`Segment fetch failed: ${res.status}`)); return; }
                controller.enqueue(new Uint8Array(await res.arrayBuffer()));
            }
        });

        return new Input({
            source: new ReadableStreamSource(stream, {
                maxCacheSize: HLS_CACHE_SIZE
            }),
            formats: [MPEG_TS],
        });
    }
    async getDuration(input) {
        if (this.playbackInfo && this.playbackInfo.runTimeTicks) {
            return this.playbackInfo.runTimeTicks / 10000000;
        }
        return await input.computeDuration();
    }
    isSeekable() {
        return this._usedDirectPlay;
    }
    getSubtitleTracks() {
        if (!this.playbackInfo) return [];
        return this.playbackInfo.streams.filter(s => s.type === 'Subtitle').map(track => ({
            id: `jf-sub-${track.index}`,
            name: track.title || track.language || `Subtitle ${track.index}`,
            externalUrl: this.jf.getSubtitleUrl(this.itemId, this.mediaSourceId, track.index)
        }));
    }
    getAudioStreamInfo() {
        if (!this.playbackInfo) return [];
        return this.playbackInfo.streams.filter(s => s.type === 'Audio').map(s => ({
            index: s.index,
            label: s.title || [s.language, s.codec].filter(Boolean).join(' / ') || `Audio ${s.index}`
        }));
    }
}

// ── SubtitleManager ────────────────────────────────────
class SubtitleManager {
    constructor(captionOverlay, captionSelectEl) {
        this._overlay = captionOverlay;
        this._selectEl = captionSelectEl; // <carplayer-custom-select>

        this._tracksById = new Map();
        this._options = [{ id: 'off', label: 'Captions Off' }];
        this._selectedId = 'off';
        this._cues = [];
        this._cueIdx = 0;
        this._loadToken = 0;
        this._getPlaybackTime = () => 0;

        if (this._selectEl) {
            this._selectEl.addEventListener('change', (e) => {
                const value = e.detail?.value;
                if (value === 'custom') {
                    this._selectEl.blur();
                    const modal = document.getElementById('captionsModal');
                    if (modal && typeof modal.open === 'function') {
                        modal.open();
                    } else if (modal) {
                        modal.classList.add('active');
                    }
                    return;
                }
                if (value) {
                    this.selectTrack(value);
                    if (this.onTrackSelected) this.onTrackSelected(value);
                }
            });
        }
    }

    setPlaybackTimeGetter(fn) { this._getPlaybackTime = fn; }

    renderText(text) {
        if (!this._overlay) return;
        const safe = String(text || '').trim();

        if (safe) {
            this._overlay.innerHTML = `<span class="caption-overlay__text">${safe}</span>`;
            this._overlay.classList.add('is-visible');
            this._overlay.style.opacity = '1';
        } else {
            this._overlay.innerHTML = '';
            this._overlay.classList.remove('is-visible');
            this._overlay.style.opacity = '0';
        }
    }

    findCueIndexForTime(time) {
        const cues = this._cues;
        if (!cues.length) return 0;
        if (time <= cues[0].start) return 0;
        const idx = cues.findIndex(c => c.end >= time);
        return idx >= 0 ? idx : cues.length - 1;
    }

    findActiveCue(time) {
        if (!this._cues.length) return null;
        let c = Math.max(0, Math.min(this._cueIdx, this._cues.length - 1));
        while (c > 0 && time < this._cues[c].start) c--;
        while (c < this._cues.length - 1 && time > this._cues[c].end) c++;
        this._cueIdx = c;
        const cue = this._cues[c];
        if (cue && time >= cue.start - 0.04 && time <= cue.end + 0.04) return cue;
        const next = this._cues[c + 1];
        if (next && time >= next.start - 0.04 && time <= next.end + 0.04) { this._cueIdx = c + 1; return next; }
        return null;
    }

    renderAtTime(time) {
        if (this._selectedId === 'off') { this.renderText(''); return; }
        this.renderText(this.findActiveCue(time)?.text || '');
    }

    resetState() { this._cues = []; this._cueIdx = 0; this.renderText(''); }

    syncSelector() {
        if (!this._selectEl) return;

        const items = this._options.map(opt => ({
            value: opt.id,
            label: opt.label,
            selected: opt.id === this._selectedId,
        }));
        // Add "Add Custom Captions..." action option
        items.push({ value: 'custom', label: 'Add Custom Captions...' });

        this._selectEl.setOptions(items);

        const validMatch = this._options.find(o => o.id === this._selectedId);
        if (!validMatch) {
            this._selectedId = 'off';
            this._selectEl.value = 'off';
        } else {
            this._selectEl.value = this._selectedId;
        }
    }

    parseTimestamp(value) {
        const raw = String(value || '').trim().replace(',', '.');
        if (!raw) return null;
        const parts = raw.split(':').map(p => Number(p.trim()));
        if (parts.some(p => !Number.isFinite(p))) return null;
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return null;
    }

    parseText(rawText, sourceUrl) {
        const text = String(rawText || '').replace(/\uFEFF/g, '').trim();
        if (!text) return [];
        const isVtt = text.toUpperCase().startsWith('WEBVTT') || String(sourceUrl || '').toLowerCase().includes('.vtt');
        const lines = text.replace(/\r\n?/g, '\n').split('\n');
        const cues = [];
        let i = 0;
        while (i < lines.length) {
            let timeline = lines[i].trim();
            const upper = timeline.toUpperCase();
            if (!timeline || (isVtt && (upper.startsWith('WEBVTT') || upper.startsWith('NOTE')))) { i++; continue; }
            if (!timeline.includes('-->')) {
                timeline = (lines[i + 1] || '').trim();
                if (!timeline.includes('-->')) { i++; continue; }
                i++;
            }
            const match = timeline.match(/^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/);
            if (!match) { i++; continue; }
            const start = this.parseTimestamp(match[1]);
            const end = this.parseTimestamp(match[2]);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { i++; continue; }
            const textLines = [];
            let cursor = i + 1;
            while (cursor < lines.length && lines[cursor].trim()) { textLines.push(lines[cursor]); cursor++; }
            const cueText = textLines.join('\n').trim();
            if (cueText) cues.push({ start, end, text: cueText });
            i = cursor + 1;
        }
        return cues.sort((a, b) => a.start - b.start);
    }

    normalizeEmbeddedCue(cue) {
        if (!cue) return null;
        const start = Number(cue.startTime ?? cue.start);
        const end = Number(cue.endTime ?? cue.end);
        const text = String(cue.text ?? cue.payload ?? '').trim();
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) return null;
        return { start, end, text };
    }

    async readTrackCueList(track) {
        if (!track) return [];
        if (Array.isArray(track.externalCueList)) return track.externalCueList;
        if (track.externalUrl) {
            try {
                const res = await fetch(track.externalUrl);
                if (res.ok) { const cues = this.parseText(await res.text(), track.externalUrl); track.externalCueList = cues; return cues; }
            } catch (e) { console.error("Failed to fetch external subtitles", e); }
        }
        const raw = track.cues ?? await track.getCues?.();
        const arr = Array.isArray(raw) ? raw : (raw && typeof raw[Symbol.iterator] === 'function' ? Array.from(raw) : []);
        return arr.map(c => this.normalizeEmbeddedCue(c)).filter(Boolean).sort((a, b) => a.start - b.start);
    }

    async selectTrack(trackId) {
        this._selectedId = String(trackId || 'off');
        this.syncSelector();
        if (this._selectedId === 'off') { this.resetState(); return; }
        const track = this._tracksById.get(this._selectedId);
        if (!track) { this._selectedId = 'off'; this.syncSelector(); this.resetState(); return; }
        const token = ++this._loadToken;
        const cues = await this.readTrackCueList(track);
        if (token !== this._loadToken) return;
        this._cues = cues;
        this._cueIdx = this.findCueIndexForTime(this._getPlaybackTime());
        this.renderAtTime(this._getPlaybackTime());
    }

    labelFromUrl(url, fallbackIndex = 0) {
        const fallback = `External Caption ${fallbackIndex + 1}`;
        try { return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '').trim() || fallback; }
        catch { return fallback; }
    }

    async loadExternalFromUrl(subtitleUrl) {
        subtitleUrl = toHttpUrl(subtitleUrl);
        if (!subtitleUrl) return false;
        let response;
        try { response = await fetch(subtitleUrl); } catch { return false; }
        if (!response.ok) return false;

        const cues = this.parseText(await response.text(), subtitleUrl);
        if (!cues.length) return false;

        let trackId = '';
        for (const [id, track] of this._tracksById.entries()) {
            if (track?.externalUrl === subtitleUrl) { track.externalCueList = cues; trackId = id; break; }
        }
        if (!trackId) {
            trackId = `ext-${Date.now()}`;
            const label = this.labelFromUrl(subtitleUrl, this._options.length);
            this._tracksById.set(trackId, { id: trackId, name: label, externalUrl: subtitleUrl, externalCueList: cues });
            this._options.push({ id: trackId, label });
            this.syncSelector();
        }
        await this.selectTrack(trackId);
        return true;
    }

    async collectTracks(input) {
        let tracks = [];
        if (typeof input.getSubtitleTracks === 'function') { try { tracks = (await input.getSubtitleTracks()) || []; } catch { tracks = []; } }
        if (!tracks.length && typeof input.getTextTracks === 'function') { try { tracks = (await input.getTextTracks()) || []; } catch { tracks = []; } }
        return collectDeduped(tracks);
    }

    initTracks(inputTracks, adapterTracks) {
        this._tracksById = new Map();
        this._options = [{ id: 'off', label: 'Captions Off' }];
        inputTracks.forEach((track, index) => {
            const id = getTrackId(track) || `caption-${index + 1}`;
            if (this._tracksById.has(id)) return;
            const label = String(track?.name || '').trim() || `Caption ${this._options.length}`;
            this._tracksById.set(id, track);
            this._options.push({ id, label });
        });
        adapterTracks.forEach(sub => {
            this._tracksById.set(sub.id, sub);
            this._options.push({ id: sub.id, label: sub.name });
        });
        this._selectedId = 'off';
        this.resetState();
        this.syncSelector();
    }

    seekTo(time) {
        this._cueIdx = this.findCueIndexForTime(time);
        this.renderAtTime(time);
    }
}

// ── AudioManager ───────────────────────────────────────
class AudioManager {
    constructor(audioTrackSelectEl, volumeControlEl, storage) {
        this._selectEl = audioTrackSelectEl; // <carplayer-custom-select>
        this._volumeControl = volumeControlEl; // <carplayer-volume-control>
        this.storage = storage;

        this.context = null;
        this.gainNode = null;
        this.sink = null;
        this.iterator = null;
        this.tracks = [];
        this.selectedIndex = 0;
        this.volumeLevel = this.storage.getVolume();
        this.queuedNodes = new Set();

        if (this._selectEl) {
            this._selectEl.addEventListener('change', (e) => {
                const value = parseInt(e.detail?.value, 10);
                if (!isNaN(value)) {
                    if (this.onTrackSelected) this.onTrackSelected(value);
                }
            });
        }

        if (this._volumeControl) {
            // Set initial value to component so it reflects storage
            this._volumeControl.volume = this.volumeLevel;

            this._volumeControl.addEventListener('volumechange', (e) => {
                this.volumeLevel = e.detail.volume;
                this.storage.saveVolume(this.volumeLevel);
                this.updateVolumeState();
            });
        }
    }

    updateVolumeState() {
        if (this.gainNode) {
            const effectiveVol = this._volumeControl ? this._volumeControl.effectiveVolume : this.volumeLevel;
            this.gainNode.gain.value = effectiveVol * effectiveVol;
        }
    }

    syncSelector() {
        if (!this._selectEl) return;

        if (!this.tracks.length && !this._metaTracks?.length) {
            this._selectEl.setOptions([{ value: '-1', label: 'No audio' }]);
            this._selectEl.hide();
            return;
        }

        this._selectEl.show();

        if (this._metaTracks?.length) {
            const items = this._metaTracks.map(t => ({
                value: String(t.index),
                label: t.label,
                selected: t.index === this._selectedMetaIndex,
            }));
            this._selectEl.setOptions(items);
            return;
        }

        const items = this.tracks.map((track, i) => {
            let label = String(track?.name || '').trim();
            if (!label || label === `Audio ${i + 1}`) {
                const lang = track?.language || '';
                const codec = track?.codec || '';
                const parts = [lang, codec].filter(Boolean).join(' / ');
                label = parts ? `Audio ${i + 1} (${parts})` : `Audio ${i + 1}`;
            }
            return { value: String(i), label, selected: i === this.selectedIndex };
        });
        this._selectEl.setOptions(items);
    }

    setTrackByIndex(index, { restartPlayback = true, getPlaybackTime, playing, pause, play } = {}) {
        const track = this.tracks[index];
        if (!track) return;
        let nextSink;
        try { nextSink = new AudioBufferSink(track); } catch { this.syncSelector(); return; }
        const currentTime = Math.max(0, getPlaybackTime?.() || 0);
        const wasPlaying = playing;
        if (wasPlaying && restartPlayback) pause?.();
        this.sink = nextSink;
        this.selectedIndex = index;
        this.syncSelector();
        if (restartPlayback && wasPlaying) play?.();
    }

    async collectTracks(input, primaryTrack) {
        let tracks = [];
        if (typeof input.getAudioTracks === 'function') { try { tracks = (await input.getAudioTracks()) || []; } catch { tracks = []; } }
        if (!tracks.length && primaryTrack) tracks = [primaryTrack];
        return collectDeduped(tracks);
    }

    unlockContext() {
        if (this.context) {
            if (this.context.state === 'suspended') {
                this.context.resume().catch(() => { });
            }
            return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        this.context = new AC();
        if (this.context.state === 'suspended') {
            this.context.resume().catch(() => { });
        }
        this.gainNode = this.context.createGain();
        this.gainNode.connect(this.context.destination);
        this.updateVolumeState();
    }

    stopAllNodes() {
        for (const node of this.queuedNodes) node.stop();
        this.queuedNodes.clear();
    }

    async stopIterator() {
        await this.iterator?.return();
        this.iterator = null;
    }

    setMetaTracks(metaTracks) {
        this._metaTracks = metaTracks;
        this._selectedMetaIndex = metaTracks?.[0]?.index ?? null;
        this.syncSelector();
    }
    selectMetaIndex(index) {
        this._selectedMetaIndex = index;
        this.syncSelector();
    }
}

// ── PlayerController ───────────────────────────────────
export default class PlayerController {
    constructor(app, storage) {
        this.app = app;
        this.storage = storage;

        this.dom = app.dom;
        this.canvas = this.dom.canvas;
        this.ctx = this.dom.ctx || this.canvas.getContext('2d');
        this.loader = this.dom.loader;
        this.topBar = document.getElementById("topBar");

        this.subs = new SubtitleManager(
            this.dom.captionOverlay,
            this.dom.videoControls.captionSelect
        );

        this.audio = new AudioManager(
            this.dom.videoControls.audioTrackSelect,
            this.dom.videoControls.volumeControl,
            this.storage
        );

        this.playing = false;
        this.playbackSpeed = this.storage.getSpeed() || 1;
        this.fileLoaded = false;
        this.totalDuration = 0;
        this.playbackTimeAtStart = 0;
        this.audioContextStartTime = 0;
        this.videoSink = null;
        this.videoFrameIterator = null;
        this.nextFrame = null;
        this.asyncId = 0;
        this.internalTimestampOffset = 0;
        this.draggingProgressBar = false;
        this.bufferedFrom = 0;
        this.bufferedUntil = 0;
        this.hideControlsTimeout = null;

        this.TARGET_BUFFER_SECONDS = this.storage.getVideoBuffer();
        this.AUTO_HIDE_DELAY_MS = 3000;

        this.currentUrl = '';

        this.subs.setPlaybackTimeGetter(() => this.getPlaybackTime());
        this._bindEvents();
        this.updatePlayPauseIcon();
        this.audio.updateVolumeState();
        requestAnimationFrame(() => this._render());

        // Sync initial speed UI
        this._updateSpeedUI(this.playbackSpeed);
    }

    setDependencies(deps) {
        this.historyRenderer = deps.historyRenderer;
    }

    getPlaybackTime() {
        if (this.playing && this.audio.context) {
            return this.playbackTimeAtStart + (this.audio.context.currentTime - this.audioContextStartTime) * this.playbackSpeed;
        }
        return this.playbackTimeAtStart;
    }

    updatePlayPauseIcon() {
        if (this.dom.videoControls) {
            this.dom.videoControls.playing = this.playing;
        }
        if (this.playing && this.dom.skipIndicator) {
            // No longer adding 'hidden' here as it conflicts with our glossy overlay
        }
    }

    clearHideTimer() {
        if (this.hideControlsTimeout !== null) { clearTimeout(this.hideControlsTimeout); this.hideControlsTimeout = null; }
    }

    setControlsIdleState(idle) {
        const isIdle = Boolean(idle);
        this.dom.videoControls?.setIdle(isIdle);
        this.topBar?.setIdle(isIdle);
        this.dom.captionOverlay?.classList.toggle('controls-idle', isIdle);
        this.dom.playerScreen.style.cursor = isIdle ? 'none' : 'default';
    }

    scheduleAutoHide() {
        this.clearHideTimer();
        if (!this.playing || this.draggingProgressBar) return;
        this.hideControlsTimeout = setTimeout(() => {
            if (this.playing && !this.draggingProgressBar) {
                this.setControlsIdleState(true);
                this.dom.videoControls?.qualitySelect?.blur();
            }
        }, this.AUTO_HIDE_DELAY_MS);
    }

    showControls() {
        this.setControlsIdleState(false);
        this.scheduleAutoHide();
    }

    updateProgressBarTime(seconds) {
        if (!this.totalDuration) { this.dom.videoControls?.setTime(0, 0); return; }
        const safe = Math.max(0, Math.min(seconds, this.totalDuration));
        this.dom.videoControls?.setTime(safe, this.totalDuration);
    }

    updateBufferedBar() {
        if (!this.dom.videoControls?.progressBar) return;
        if (!this.totalDuration || this.bufferedUntil <= this.bufferedFrom) return;

        this.dom.videoControls.progressBar.setBuffered(this.bufferedFrom, this.bufferedUntil);
    }

    resetBufferedBar(time = 0) { this.bufferedFrom = Math.max(0, Number(time) || 0); this.bufferedUntil = this.bufferedFrom; this.updateBufferedBar(); }
    extendBufferedUntil(time) { if (time > this.bufferedUntil) { this.bufferedUntil = time; this.updateBufferedBar(); } }

    async startVideoIterator() {
        if (!this.videoSink) return;
        this.asyncId++;
        await this.videoFrameIterator?.return();
        const useSeq = this.adapter && !this.adapter.isSeekable();
        const startAt = useSeq ? undefined : this.getPlaybackTime();
        this.videoFrameIterator = this.videoSink.canvases(startAt);
        const firstResult = await this.videoFrameIterator.next();
        const first = firstResult.value ?? null;
        if (first) {
            if (useSeq) {
                this.internalTimestampOffset = this.playbackTimeAtStart - first.timestamp;
            } else {
                this.internalTimestampOffset = 0;
            }
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.drawImage(first.canvas, 0, 0);
        }
        this.nextFrame = (await this.videoFrameIterator.next()).value ?? null;
    }

    async updateNextFrame() {
        const localId = this.asyncId;
        while (true) {
            const candidate = (await this.videoFrameIterator?.next())?.value ?? null;
            if (!candidate || localId !== this.asyncId) break;
            if (candidate.timestamp <= this.getPlaybackTime()) {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.drawImage(candidate.canvas, 0, 0);
                continue;
            }
            this.nextFrame = candidate;
            break;
        }
    }

    async _setupVideoSink(videoTrack) {
        if (videoTrack) {
            const alpha = typeof videoTrack.canBeTransparent === 'function' ? await videoTrack.canBeTransparent() : false;
            this.videoSink = new CanvasSink(videoTrack, { poolSize: 2, fit: 'contain', alpha });
            this.canvas.width = videoTrack.displayWidth;
            this.canvas.height = videoTrack.displayHeight;
        } else {
            this.videoSink = null;
        }
    }

    async runAudioIterator() {
        if (!this.audio.sink || !this.audio.iterator) return;
        for await (const { buffer, timestamp } of this.audio.iterator) {
            if (!this.playing) break;
            const absTs = timestamp + this.internalTimestampOffset;
            this.extendBufferedUntil(absTs + (buffer?.duration || 0));
            const node = this.audio.context.createBufferSource();
            node.buffer = buffer;
            node.playbackRate.value = this.playbackSpeed;
            node.connect(this.audio.gainNode);
            const delta = absTs - this.playbackTimeAtStart;
            const startAt = this.audioContextStartTime + (delta / this.playbackSpeed);
            if (startAt >= this.audio.context.currentTime) {
                node.start(startAt);
            } else {
                const elapsed = (this.audio.context.currentTime - this.audioContextStartTime) * this.playbackSpeed;
                node.start(this.audio.context.currentTime, Math.max(0, elapsed - delta));
            }
            this.audio.queuedNodes.add(node);
            node.onended = () => this.audio.queuedNodes.delete(node);
            while (this.playing && (timestamp - this.getPlaybackTime()) > this.TARGET_BUFFER_SECONDS) {
                await new Promise(r => setTimeout(r, 50));
            }
        }
    }

    async play() {
        if (!this.fileLoaded || !this.audio.context) return;
        if (this.audio.context.state === 'suspended') await this.audio.context.resume();
        if (this.getPlaybackTime() >= this.totalDuration) { this.playbackTimeAtStart = 0; await this.startVideoIterator(); }
        this.audioContextStartTime = this.audio.context.currentTime;
        this.playing = true;
        if (this.audio.sink) {
            await this.audio.stopIterator();
            this.resetBufferedBar(this.getPlaybackTime());
            const startAt = (this.adapter && !this.adapter.isSeekable()) ? undefined : this.getPlaybackTime();
            this.audio.iterator = this.audio.sink.buffers(startAt);
            void this.runAudioIterator();
        }
        this.updatePlayPauseIcon();
        this.scheduleAutoHide();
    }

    pause() {
        if (!this.playing) return;
        this.playbackTimeAtStart = this.getPlaybackTime();

        // Save history position when pausing
        if (this.currentUrl) {
            this.storage.savePlaybackPos(this.currentUrl, this.playbackTimeAtStart, this.totalDuration);
            this.historyRenderer?.render();
        }

        this.playing = false;
        this.audio.iterator?.return();
        this.audio.iterator = null;
        this.audio.stopAllNodes();
        this.updatePlayPauseIcon();
        this.clearHideTimer();
        this.showControls();
    }

    togglePlay() { if (this.playing) this.pause(); else void this.play(); }

    async seekToTime(seconds) {
        if (!this.fileLoaded) return;
        const target = Math.max(0, Math.min(Number(seconds) || 0, this.totalDuration || 0));
        this.updateProgressBarTime(target);
        const wasPlaying = this.playing;
        if (wasPlaying) this.pause();
        this.playbackTimeAtStart = target;
        this.resetBufferedBar(target);
        this.subs.seekTo(target);

        if (this.adapter && !this.adapter.isSeekable()) {
            this.loader.classList.add('is-visible');
            this.asyncId++;
            await this.videoFrameIterator?.return();
            await this.audio.stopIterator();
            this.videoFrameIterator = null;
            this.nextFrame = null;

            try {
                const input = await this.adapter.createInput(target);
                let videoTrack = await input.getPrimaryVideoTrack();
                if (!(await canDecodeTrack(videoTrack))) videoTrack = null;
                await this._setupVideoSink(videoTrack);

                const primaryAudioTrack = await input.getPrimaryAudioTrack();
                let audioTracks = await this.audio.collectTracks(input, primaryAudioTrack);
                audioTracks = await filterDecodable(audioTracks);
                let audioTrack = null;
                const expectedId = getTrackId(this.audio.tracks[this.audio.selectedIndex]);
                if (expectedId) audioTrack = audioTracks.find(t => getTrackId(t) === expectedId) || null;
                if (!audioTrack) audioTrack = audioTracks[0] || null;
                this.audio.tracks = audioTracks;
                this.audio.selectedIndex = Math.max(0, this.audio.tracks.findIndex(t => t === audioTrack));
                if (!this.audio.tracks.length) this.audio.selectedIndex = 0;
                if (this.audio.tracks.length) {
                    this.audio.setTrackByIndex(this.audio.selectedIndex, { restartPlayback: false });
                }
                this.loader.classList.remove('is-visible');
            } catch (e) {
                console.error("[Player] Seek failed:", e);
                this.loader.classList.remove('is-visible');
                this.updatePlayPauseIcon();
                return;
            }
        }

        await this.startVideoIterator();
        if (wasPlaying && target < this.totalDuration) await this.play();

        // Save history position when seeking
        if (this.currentUrl) {
            this.storage.savePlaybackPos(this.currentUrl, target, this.totalDuration);
            this.historyRenderer?.render();
        }
    }

    _updateSpeedUI(speed) {
        if (this.dom.videoControls?.speedSelect) {
            this.dom.videoControls.speedSelect.value = String(speed);
        }
    }

    changeSpeed(newSpeed) {
        const speed = Number(newSpeed);
        if (!Number.isFinite(speed) || speed <= 0) return;
        this._updateSpeedUI(speed);
        this.storage.saveSpeed(speed);

        if (!this.playing) {
            this.playbackSpeed = speed;
            return;
        }
        const now = this.getPlaybackTime();
        this.playbackTimeAtStart = now;
        this.audioContextStartTime = this.audio.context.currentTime;
        this.playbackSpeed = speed;
        this.audio.stopAllNodes();
        if (this.audio.sink) {
            this.audio.iterator?.return();
            this.resetBufferedBar(now);
            this.audio.iterator = this.audio.sink.buffers(now);
            void this.runAudioIterator();
        }
        this.subs.renderAtTime(now);
    }

    async initMediaPlayer(adapter, options = { url: '', title: '', startTime: 0 }) {
        if (!adapter) return;
        this.currentUrl = options.url || '';

        // Safely unlock AudioContext synchronously using the current user gesture - iOS fix
        this.audio.unlockContext();

        if (this.topBar) {
            this.topBar.setAttribute("video-title", options.title || '');
        }

        try {
            if (this.playing) this.pause();

            // Switch UI immediately
            this.dom.setupScreen.classList.add('hidden');
            this.dom.playerScreen.classList.add('active');

            if (this.topBar) {
                this.topBar.style.opacity = '1';
            }

            this.loader.classList.add('is-visible');

            await adapter.init();
            this.adapter = adapter;
            this.asyncId++;
            await this.videoFrameIterator?.return();
            await this.audio.stopIterator();
            this.videoFrameIterator = null;
            this.nextFrame = null;
            // AudioContext is no longer closed here; we reuse the unlocked one
            this.fileLoaded = false;

            this.showControls();

            const input = await adapter.createInput(options.startTime || 0);
            this.totalDuration = await adapter.getDuration(input);
            this.playbackTimeAtStart = options.startTime || 0;
            this.updateProgressBarTime(this.playbackTimeAtStart);
            this.resetBufferedBar(0);

            let videoTrack = await input.getPrimaryVideoTrack();
            const primaryAudioTrack = await input.getPrimaryAudioTrack();
            let audioTracks = await this.audio.collectTracks(input, primaryAudioTrack);
            const subtitleTracks = await this.subs.collectTracks(input);

            if (this.dom.videoControls?.qualitySelect) {
                if (typeof adapter.getAudioStreamInfo !== 'function') this.dom.videoControls.qualitySelect.hide();
                else this.dom.videoControls.qualitySelect.show();
            }

            if (!(await canDecodeTrack(videoTrack))) videoTrack = null;
            audioTracks = await filterDecodable(audioTracks);
            let audioTrack = null;
            const primaryId = getTrackId(primaryAudioTrack);
            if (primaryId) audioTrack = audioTracks.find(t => getTrackId(t) === primaryId) || null;
            if (!audioTrack) audioTrack = audioTracks[0] || null;
            if (!videoTrack && !audioTrack) throw new Error('No supported audio/video tracks found.');

            // AudioContext is already unlocked and reused
            await this._setupVideoSink(videoTrack);
            this.canvas.style.display = videoTrack ? 'block' : 'none';

            this.audio.tracks = audioTracks;
            this.audio.selectedIndex = Math.max(0, this.audio.tracks.findIndex(t => t === audioTrack));
            if (!this.audio.tracks.length) this.audio.selectedIndex = 0;
            this.audio.sink = null;

            // Use Jellyfin metadata for audio selector if available
            const metaAudio = typeof adapter.getAudioStreamInfo === 'function' ? adapter.getAudioStreamInfo() : [];
            if (metaAudio.length > 1) {
                this.audio.setMetaTracks(metaAudio);
            } else {
                this.audio._metaTracks = null;
                this.audio.syncSelector();
            }
            if (this.audio.tracks.length) {
                this.audio.setTrackByIndex(this.audio.selectedIndex, { restartPlayback: false });
            }

            this.subs.initTracks(subtitleTracks, adapter.getSubtitleTracks());

            // Try to load manual caption url if available
            if (this.currentUrl) {
                const historyManualCap = this.storage.getManualCaptionUrl(this.currentUrl);
                if (historyManualCap) {
                    await this.subs.loadExternalFromUrl(historyManualCap);
                }

                // Restore saved subtitle selection
                const id = this.storage.extractId(this.currentUrl);
                const historyItem = this.storage.getHistory().find(h => h.id === id);
                if (historyItem && historyItem.subtitleTrackId) {
                    await this.subs.selectTrack(historyItem.subtitleTrackId);
                }
            }

            this.fileLoaded = true;
            await this.startVideoIterator();

            // Try to un-suspend and auto-play
            try {
                if (this.audio.context.state === 'suspended') {
                    await this.audio.context.resume();
                }
                await this.play();
            } catch {
                this.updatePlayPauseIcon();
            }
            this.loader.classList.remove('is-visible');
        } catch (error) {
            console.error("Player initialization failed:", error);
            this.fileLoaded = false;
            this.loader.classList.remove('is-visible');
            this.updatePlayPauseIcon();
            this.exitPlayer();
            alert(`Playback failed: ${error.message}`);
        }
    }

    // Main entry point for playing a URL
    async loadVideo(videoUrl) {
        if (!videoUrl) return;
        const normalizedUrl = toHttpUrl(videoUrl);
        if (!normalizedUrl) return;

        this.app.dom.urlInput.value = "";
        this.app.closeModal("urlModal");

        let title = this.app.getVideoTitleFromUrl(normalizedUrl);
        this.storage.addHistory(normalizedUrl, title);
        const { time } = this.storage.getPlaybackPos(normalizedUrl);

        await this.initMediaPlayer(new DirectMp4Adapter(normalizedUrl), {
            url: normalizedUrl,
            title: title,
            startTime: time || 0
        });
    }

    // Main entry point for playing Jellyfin
    async loadJellyfinItem(jf, itemId, title, url, qualityStr) {

        this.dom.setupScreen.classList.add('hidden');
        this.dom.playerScreen.classList.add('active');
        this.loader.classList.add('is-visible');

        try {
            const adapter = new JellyfinAdapter(jf, itemId, this.storage, qualityStr);

            const displayTitle = title || this.getVideoTitleFromUrl(url) || 'Jellyfin Video';
            if (this.topBar) {
                this.topBar.setAttribute("video-title", displayTitle);
            }

            this.currentUrl = url;
            const { time } = this.storage.getPlaybackPos(url);

            await this.initMediaPlayer(adapter, { url: url, title: displayTitle, startTime: time || 0 });

            if (this.historyRenderer) {
                this.historyRenderer.render();
            }
        } catch (error) {
            console.error("Jellyfin Playback Error:", error);
            this.loader.classList.remove('is-visible');
            this.dom.playerScreen.classList.remove('active');
            this.dom.setupScreen.classList.remove('hidden');

            // Clean up potentially hung player state
            if (this.audio.context) { await this.audio.context.close(); this.audio.context = null; }
            this.fileLoaded = false;
            this.playing = false;
            this.updatePlayPauseIcon();

            alert(`Unable to play video.\n\nCheck if your Jellyfin server is accessible and CORS is configured.\n\nDebug: ${error.message}`);
        }
    }

    async loadExternalCaptionUrl(captionUrl) {
        if (!this.fileLoaded) {
            alert('Load video first.');
            return false;
        }
        const url = toHttpUrl(captionUrl);
        if (!url) return false;

        const success = await this.subs.loadExternalFromUrl(url);
        if (success && this.currentUrl) {
            this.storage.saveManualCaptionUrl(this.currentUrl, url);
        } else if (!success) {
            alert('Failed to load captions from this URL.');
        }
        return success;
    }

    _render() {
        if (this.fileLoaded && this.dom.playerScreen.style.display !== 'none') {
            const t = this.getPlaybackTime();
            if (this.playing && t >= this.totalDuration) { this.pause(); this.playbackTimeAtStart = this.totalDuration; }
            if (this.nextFrame && (this.nextFrame.timestamp + this.internalTimestampOffset) <= t) {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.drawImage(this.nextFrame.canvas, 0, 0);
                this.nextFrame = null;
                void this.updateNextFrame();
            }
            if (!this.draggingProgressBar) this.updateProgressBarTime(t);
            this.subs.renderAtTime(t);
            if (this.playing && t > this.bufferedFrom) { this.bufferedFrom = t; this.updateBufferedBar(); }
        }
        requestAnimationFrame(() => this._render());
    }

    _bindEvents() {
        if (this.dom.videoControls) {
            this.dom.videoControls.addEventListener('action-skip', (e) => {
                const dir = e.detail > 0 ? 'forward' : 'backward';
                this._triggerSkipIndicator(dir);
                this.seekToTime(this.getPlaybackTime() + e.detail);
            });
            this.dom.videoControls.addEventListener('action-play', () => this.play());
            this.dom.videoControls.addEventListener('action-pause', () => this.pause());

            this.dom.videoControls.progressBar.addEventListener('seek-preview', (e) => {
                this.draggingProgressBar = true;
                this.updateProgressBarTime(e.detail);
            });
            this.dom.videoControls.progressBar.addEventListener('seek', (e) => {
                this.draggingProgressBar = false;
                this.seekToTime(e.detail);
                this.scheduleAutoHide();
            });

            if (this.dom.videoControls.speedSelect) {
                this.dom.videoControls.speedSelect.addEventListener('change', (e) => {
                    this.changeSpeed(e.detail.value);
                });
            }

            if (this.dom.videoControls.qualitySelect) {
                const preferredQuality = this.storage.getPreferredQualityId() || '720';
                this.dom.videoControls.qualitySelect.value = preferredQuality;

                this.dom.videoControls.qualitySelect.addEventListener('change', async (e) => {
                    const value = e.detail.value;
                    this.storage.savePreferredQualityId(value);

                    if (this.adapter && typeof this.adapter.setQuality === 'function') {
                        const currentTime = this.getPlaybackTime();
                        this.adapter.setQuality(value);
                        await this.seekToTime(currentTime);
                    }
                });
            }
        }

        this.topBar?.addEventListener("back", () => this._handleBack());

        let lastClickTime = 0;
        let lastClickPosition = '';

        this.dom.playerScreen.addEventListener('click', (e) => {
            // Handle clicking the background to show skip indicators/playpause
            if (!e.target.closest('carplayer-video-controls') && !e.target.closest('.player-topbar') && !e.target.closest('.modal')) {

                // If the user clicks the screen just to dismiss an open select menu, ignore the click
                if (document.querySelector('carplayer-custom-select.is-open')) {
                    return;
                }

                const screenWidth = window.innerWidth;
                const clickX = e.clientX;
                const thirdOfScreen = screenWidth / 3;

                const now = Date.now();
                const timeSinceLastClick = now - lastClickTime;

                let position = 'middle';
                if (clickX < thirdOfScreen) position = 'left';
                else if (clickX > screenWidth - thirdOfScreen) position = 'right';

                if (position === 'middle') {
                    // Immediate toggle for middle click
                    lastClickTime = 0;
                    clearTimeout(this.clickTimeout);
                    this.togglePlay();
                } else {
                    // Left or Right edges
                    if (timeSinceLastClick < 300 && lastClickPosition === position) {
                        // Double click
                        clearTimeout(this.clickTimeout);
                        if (position === 'left') {
                            this._triggerSkipIndicator('backward');
                            this.seekToTime(this.getPlaybackTime() - 10);
                        } else {
                            this._triggerSkipIndicator('forward');
                            this.seekToTime(this.getPlaybackTime() + 10);
                        }
                        lastClickTime = 0; // Reset to require another double click
                    } else {
                        // Single click (wait to see if it becomes double)
                        lastClickTime = now;
                        lastClickPosition = position;
                        clearTimeout(this.clickTimeout);
                        this.clickTimeout = setTimeout(() => {
                            this.togglePlay();
                        }, 300);
                    }
                }
            }
        });

        this.dom.playerScreen.addEventListener('pointermove', () => this.showControls());
        this.dom.playerScreen.addEventListener('pointerdown', () => this.showControls());
        this.dom.playerScreen.addEventListener('mouseleave', () => {
            this.clearHideTimer();
            if (this.playing && !this.draggingProgressBar) {
                this.setControlsIdleState(true);
            }
        });

        // Subtitle Track changes
        this.subs.onTrackSelected = (selectedValue) => {
            if (this.currentUrl) {
                this.storage.updateHistoryItem(this.currentUrl, { subtitleTrackId: selectedValue });
            }
        };

        // Audio Track changes -> pass to AudioManager handler
        this.audio.onTrackSelected = async (selectedValue) => {
            // If adapter supports audio index switching (Jellyfin HLS), rebuild pipeline
            if (this.adapter && typeof this.adapter.setAudioIndex === 'function' && this.audio._metaTracks?.length) {
                const currentTime = this.getPlaybackTime();
                this.audio.selectMetaIndex(selectedValue);
                this.adapter.setAudioIndex(selectedValue);
                await this.seekToTime(currentTime);
                return;
            }
            this.audio.setTrackByIndex(selectedValue, {
                restartPlayback: true,
                getPlaybackTime: () => this.getPlaybackTime(),
                playing: this.playing,
                pause: () => this.pause(),
                play: () => void this.play(),
            });
        };

        // Back buttons
        this.dom.btnBack?.addEventListener('click', () => {
            this.exitPlayer();
        });
    }

    _handleBack() {
        if (this.dom.playerScreen.classList.contains('active')) {
            this.exitPlayer();
        }
    }

    _triggerSkipIndicator(direction) {
        if (!this.dom.skipIndicator) return;

        clearTimeout(this.skipIndicatorTimeout);
        this.dom.skipIndicator.classList.remove("is-visible", "skip-indicator--left", "skip-indicator--right");

        // Small delay to allow CSS transition to reset if rapidly clicking
        setTimeout(() => {
            const skipClass = direction === "backward" ? "skip-indicator--left" : "skip-indicator--right";
            this.dom.skipIndicator.classList.add(skipClass);
            this.dom.skipIndicator.innerHTML =
                direction === "backward"
                    ? `<span class="skip-text">&lt;&lt; -10s</span>`
                    : `<span class="skip-text">+10s &gt;&gt;</span>`;
            this.dom.skipIndicator.classList.add("is-visible");

            this.skipIndicatorTimeout = setTimeout(() => {
                this.dom.skipIndicator.classList.remove("is-visible");
            }, 600);
        }, 10);
    }

    exitPlayer() {
        this.pause();
        this.storage.savePlaybackPos(this.currentUrl, this.playbackTimeAtStart, this.totalDuration);

        try {
            const dataUrl = this.canvas.toDataURL('image/jpeg', 0.5);
            this.storage.saveHistoryThumbnail(this.currentUrl, dataUrl);
        } catch (e) {
            console.warn('Could not save canvas thumbnail:', e);
        }

        this.historyRenderer?.render();
        this.dom.setupScreen.classList.remove('hidden');
        this.dom.playerScreen.classList.remove('active');

        this.asyncId++;
        this.videoFrameIterator?.return();
        this.audio.stopIterator();
        if (this.audio.context) { this.audio.context.close(); this.audio.context = null; }
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.fileLoaded = false;
        this.totalDuration = 0;
        this.playbackTimeAtStart = 0;

        this.subs.resetState();
    }
}
