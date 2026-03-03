import {
	STATE,
	SOURCE_MODE,
	SourceFactory,
	JellyfinPlaybackClient,
	AudioMsePipeline,
	VideoCanvasPipeline,
	getTrackId,
} from './playback/engine-core.js';

const FIRST_APPEND_TIMEOUT_MS = 5000;
const FIRST_APPEND_TIMEOUT_JELLYFIN_MS = 6500;
const VIDEO_PRIME_TIMEOUT_MS = 900;
const DOUBLE_TAP_WINDOW_MS = 300;
const SKIP_STEP_SECONDS = 10;
const SKIP_INDICATOR_HIDE_MS = 600;

const AUTO_PLAY_MODE = Object.freeze({
	ALWAYS: 'always',
	PRESERVE: 'preserve',
});

const TRANSITION_MODE = Object.freeze({
	INITIAL_LOAD: 'initial-load',
	SEEK: 'seek',
	AUDIO_SWITCH: 'audio-switch',
	QUALITY_SWITCH: 'quality-switch',
});

const UI_CONTROLS_MODE = Object.freeze({
	AUTO_HIDE: 'auto-hide',
	SHOW: 'show',
	KEEP: 'keep',
});

const toHttpUrl = (value) => {
	const raw = String(value || '').trim();
	if(!raw) return '';
	try {
		const u = new URL(raw);
		return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
	} catch {
		return '';
	}
};

const canDecodeTrack = async(track) => {
	if(!track) return false;
	if(typeof track.canDecode !== 'function') return true;
	try {
		return Boolean(await track.canDecode());
	} catch {
		return false;
	}
};

const collectDeduped = (tracks) => {
	const deduped = [];
	const seen = new Set();

	for(const track of tracks || []) {
		if(!track) continue;
		const id = getTrackId(track);
		if(id && seen.has(id)) continue;
		if(id) seen.add(id);
		deduped.push(track);
	}

	return deduped;
};

export const formatSeconds = (seconds) => {
	const safe = Math.max(0, Number(seconds) || 0);
	const hours = Math.floor(safe / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const secs = Math.floor(safe % 60);
	if(hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
	return `${minutes}:${String(secs).padStart(2, '0')}`;
};

class SubtitleManager {
	constructor(captionOverlay, captionSelectEl) {
		this._overlay = captionOverlay;
		this._selectEl = captionSelectEl;

		this._tracksById = new Map();
		this._options = [{id: 'off', label: 'Captions Off'}];
		this._selectedId = 'off';
		this._cues = [];
		this._cueIdx = 0;
		this._loadToken = 0;
		this._getPlaybackTime = () => 0;

		if(this._selectEl) {
			this._selectEl.addEventListener('change', (e) => {
				const value = e.detail?.value;
				if(value === 'custom') {
					this._selectEl.blur();
					const modal = document.getElementById('captionsModal');
					if(modal && typeof modal.open === 'function') {
						modal.open();
					} else if(modal) {
						modal.classList.add('active');
					}
					return;
				}
				if(value) {
					this.selectTrack(value);
					if(this.onTrackSelected) this.onTrackSelected(value);
				}
			});
		}
	}

	setPlaybackTimeGetter(fn) {
		this._getPlaybackTime = fn;
	}

	getSelectedTrackId() {
		return this._selectedId;
	}

	renderText(text) {
		if(!this._overlay) return;
		const safe = String(text || '').trim();

		if(safe) {
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
		if(!cues.length) return 0;
		if(time <= cues[0].start) return 0;
		const idx = cues.findIndex((c) => c.end >= time);
		return idx >= 0 ? idx : cues.length - 1;
	}

	findActiveCue(time) {
		if(!this._cues.length) return null;

		let c = Math.max(0, Math.min(this._cueIdx, this._cues.length - 1));
		while(c > 0 && time < this._cues[c].start) c -= 1;
		while(c < this._cues.length - 1 && time > this._cues[c].end) c += 1;
		this._cueIdx = c;

		const cue = this._cues[c];
		if(cue && time >= cue.start - 0.04 && time <= cue.end + 0.04) return cue;

		const next = this._cues[c + 1];
		if(next && time >= next.start - 0.04 && time <= next.end + 0.04) {
			this._cueIdx = c + 1;
			return next;
		}

		return null;
	}

	renderAtTime(time) {
		if(this._selectedId === 'off') {
			this.renderText('');
			return;
		}
		this.renderText(this.findActiveCue(time)?.text || '');
	}

	resetState() {
		this._cues = [];
		this._cueIdx = 0;
		this.renderText('');
	}

	syncSelector() {
		if(!this._selectEl) return;

		const items = this._options.map((opt) => ({
			value: opt.id,
			label: opt.label,
			selected: opt.id === this._selectedId,
		}));
		items.push({value: 'custom', label: 'Add Custom Captions...'});

		this._selectEl.setOptions(items);

		const validMatch = this._options.find((o) => o.id === this._selectedId);
		if(!validMatch) {
			this._selectedId = 'off';
			this._selectEl.value = 'off';
		} else {
			this._selectEl.value = this._selectedId;
		}
	}

	parseTimestamp(value) {
		const raw = String(value || '').trim().replace(',', '.');
		if(!raw) return null;

		const parts = raw.split(':').map((p) => Number(p.trim()));
		if(parts.some((p) => !Number.isFinite(p))) return null;

		if(parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
		if(parts.length === 2) return parts[0] * 60 + parts[1];

		return null;
	}

	parseText(rawText, sourceUrl) {
		const text = String(rawText || '').replace(/\uFEFF/g, '').trim();
		if(!text) return [];

		const isVtt = text.toUpperCase().startsWith('WEBVTT') || String(sourceUrl || '').toLowerCase().includes('.vtt');
		const lines = text.replace(/\r\n?/g, '\n').split('\n');
		const cues = [];

		let i = 0;
		while(i < lines.length) {
			let timeline = lines[i].trim();
			const upper = timeline.toUpperCase();

			if(!timeline || (isVtt && (upper.startsWith('WEBVTT') || upper.startsWith('NOTE')))) {
				i += 1;
				continue;
			}

			if(!timeline.includes('-->')) {
				timeline = (lines[i + 1] || '').trim();
				if(!timeline.includes('-->')) {
					i += 1;
					continue;
				}
				i += 1;
			}

			const match = timeline.match(/^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/);
			if(!match) {
				i += 1;
				continue;
			}

			const start = this.parseTimestamp(match[1]);
			const end = this.parseTimestamp(match[2]);
			if(!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
				i += 1;
				continue;
			}

			const textLines = [];
			let cursor = i + 1;
			while(cursor < lines.length && lines[cursor].trim()) {
				textLines.push(lines[cursor]);
				cursor += 1;
			}

			const cueText = textLines.join('\n').trim();
			if(cueText) cues.push({start, end, text: cueText});
			i = cursor + 1;
		}

		return cues.sort((a, b) => a.start - b.start);
	}

	normalizeEmbeddedCue(cue) {
		if(!cue) return null;

		const start = Number(cue.startTime ?? cue.start);
		const end = Number(cue.endTime ?? cue.end);
		const text = String(cue.text ?? cue.payload ?? '').trim();

		if(!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) return null;

		return {start, end, text};
	}

	async readTrackCueList(track) {
		if(!track) return [];

		if(Array.isArray(track.externalCueList)) return track.externalCueList;

		if(track.externalUrl) {
			try {
				const res = await fetch(track.externalUrl);
				if(res.ok) {
					const cues = this.parseText(await res.text(), track.externalUrl);
					track.externalCueList = cues;
					return cues;
				}
			} catch(e) {
				console.error('Failed to fetch external subtitles', e);
			}
		}

		const raw = track.cues ?? (await track.getCues?.());
		const arr = Array.isArray(raw)
			? raw
			: (raw && typeof raw[Symbol.iterator] === 'function' ? Array.from(raw) : []);

		return arr
			.map((c) => this.normalizeEmbeddedCue(c))
			.filter(Boolean)
			.sort((a, b) => a.start - b.start);
	}

	async selectTrack(trackId) {
		this._selectedId = String(trackId || 'off');
		this.syncSelector();

		if(this._selectedId === 'off') {
			this.resetState();
			return;
		}

		const track = this._tracksById.get(this._selectedId);
		if(!track) {
			this._selectedId = 'off';
			this.syncSelector();
			this.resetState();
			return;
		}

		const token = ++this._loadToken;
		const cues = await this.readTrackCueList(track);
		if(token !== this._loadToken) return;

		this._cues = cues;
		this._cueIdx = this.findCueIndexForTime(this._getPlaybackTime());
		this.renderAtTime(this._getPlaybackTime());
	}

	labelFromUrl(url, fallbackIndex = 0) {
		const fallback = `External Caption ${fallbackIndex + 1}`;
		try {
			return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '').trim() || fallback;
		} catch {
			return fallback;
		}
	}

	async loadExternalFromUrl(subtitleUrl) {
		const url = toHttpUrl(subtitleUrl);
		if(!url) return false;

		let response;
		try {
			response = await fetch(url);
		} catch {
			return false;
		}

		if(!response.ok) return false;

		const cues = this.parseText(await response.text(), url);
		if(!cues.length) return false;

		let trackId = '';
		for(const [id, track] of this._tracksById.entries()) {
			if(track?.externalUrl === url) {
				track.externalCueList = cues;
				trackId = id;
				break;
			}
		}

		if(!trackId) {
			trackId = `ext-${Date.now()}`;
			const label = this.labelFromUrl(url, this._options.length);
			this._tracksById.set(trackId, {
				id: trackId,
				name: label,
				externalUrl: url,
				externalCueList: cues,
			});
			this._options.push({id: trackId, label});
			this.syncSelector();
		}

		await this.selectTrack(trackId);
		return true;
	}

	async collectTracks(input) {
		let tracks = [];

		if(typeof input.getSubtitleTracks === 'function') {
			try {
				tracks = (await input.getSubtitleTracks()) || [];
			} catch {
				tracks = [];
			}
		}

		if(!tracks.length && typeof input.getTextTracks === 'function') {
			try {
				tracks = (await input.getTextTracks()) || [];
			} catch {
				tracks = [];
			}
		}

		return collectDeduped(tracks);
	}

	initTracks(inputTracks, adapterTracks, preferredTrackId = 'off') {
		this._tracksById = new Map();
		this._options = [{id: 'off', label: 'Captions Off'}];

		inputTracks.forEach((track, index) => {
			const id = getTrackId(track) || `caption-${index + 1}`;
			if(this._tracksById.has(id)) return;
			const label = String(track?.name || '').trim() || `Caption ${this._options.length}`;
			this._tracksById.set(id, track);
			this._options.push({id, label});
		});

		(adapterTracks || []).forEach((sub) => {
			this._tracksById.set(sub.id, sub);
			this._options.push({id: sub.id, label: sub.name});
		});

		if(preferredTrackId && this._tracksById.has(preferredTrackId)) {
			this._selectedId = preferredTrackId;
		} else {
			this._selectedId = 'off';
		}

		this.resetState();
		this.syncSelector();

		if(this._selectedId !== 'off') {
			void this.selectTrack(this._selectedId);
		}
	}

	seekTo(time) {
		this._cueIdx = this.findCueIndexForTime(time);
		this.renderAtTime(time);
	}
}

class AudioUiManager {
	constructor(audioTrackSelectEl, volumeControlEl, storage, audioElement) {
		this._selectEl = audioTrackSelectEl;
		this._volumeControl = volumeControlEl;
		this._storage = storage;
		this._audio = audioElement;

		this._mode = 'none';
		this._directTracks = [];
		this._selectedDirectTrackId = '';
		this._jellyfinTracks = [];
		this._selectedJellyfinIndex = null;

		this._bindEvents();
		this._applyInitialVolume();
	}

	_bindEvents() {
		if(this._selectEl) {
			this._selectEl.addEventListener('change', (e) => {
				const raw = e.detail?.value;
				if(this._mode === 'direct') {
					if(this.onTrackSelected) {
						this.onTrackSelected({mode: 'direct', audioTrackId: String(raw || '')});
					}
					return;
				}

				if(this._mode === 'jellyfin') {
					const parsed = Number(raw);
					if(Number.isInteger(parsed) && parsed >= 0) {
						if(this.onTrackSelected) {
							this.onTrackSelected({mode: 'jellyfin', audioStreamIndex: parsed});
						}
					}
				}
			});
		}

		if(this._volumeControl) {
			this._volumeControl.addEventListener('volumechange', (e) => {
				const volume = Number(e.detail?.volume);
				if(Number.isFinite(volume)) {
					this._storage.saveVolume(volume);
				}
				this.applyVolume();
			});
		}
	}

	_applyInitialVolume() {
		const storedVol = this._storage.getVolume();
		if(this._volumeControl) {
			this._volumeControl.volume = storedVol;
		}
		this.applyVolume();
	}

	applyVolume() {
		if(!this._audio || !this._volumeControl) return;
		this._audio.volume = this._volumeControl.effectiveVolume;
		this._audio.muted = false;
	}

	clearTracks() {
		this._mode = 'none';
		if(!this._selectEl) return;

		this._selectEl.setOptions([{value: '-1', label: 'No audio'}]);
		this._selectEl.hide();
	}

	setDirectTracks(tracks, selectedTrackId) {
		this._mode = 'direct';
		this._directTracks = Array.isArray(tracks) ? tracks : [];
		this._selectedDirectTrackId = String(selectedTrackId || this._directTracks[0]?.id || '');

		if(!this._selectEl) return;

		if(this._directTracks.length <= 1) {
			this._selectEl.hide();
			return;
		}

		const items = this._directTracks.map((track) => ({
			value: String(track.id),
			label: String(track.label || `Audio ${track.index}`),
			selected: String(track.id) === this._selectedDirectTrackId,
		}));

		this._selectEl.setOptions(items);
		this._selectEl.value = this._selectedDirectTrackId;
		this._selectEl.show();
	}

	setJellyfinTracks(tracks, selectedIndex) {
		this._mode = 'jellyfin';
		this._jellyfinTracks = Array.isArray(tracks) ? tracks : [];
		this._selectedJellyfinIndex = Number.isInteger(selectedIndex) ? selectedIndex : (this._jellyfinTracks[0]?.index ?? null);

		if(!this._selectEl) return;

		if(this._jellyfinTracks.length <= 1) {
			this._selectEl.hide();
			return;
		}

		const items = this._jellyfinTracks.map((track) => ({
			value: String(track.index),
			label: String(track.label || `Audio ${track.index}`),
			selected: track.index === this._selectedJellyfinIndex,
		}));

		this._selectEl.setOptions(items);
		if(this._selectedJellyfinIndex !== null) {
			this._selectEl.value = String(this._selectedJellyfinIndex);
		}
		this._selectEl.show();
	}
}

export default class PlayerController {
	constructor(app, storage) {
		this.app = app;
		this.storage = storage;

		this.dom = app.dom;
		this.canvas = this.dom.canvas;
		this.ctx = this.dom.ctx || this.canvas.getContext('2d');
		this.loader = this.dom.loader;
		this.topBar = document.getElementById('topBar');

		this.audioElement = this.dom.nativeAudio;
		if(!this.audioElement) {
			this.audioElement = document.createElement('audio');
			this.audioElement.preload = 'auto';
			this.audioElement.style.display = 'none';
			this.dom.playerScreen.appendChild(this.audioElement);
		}

		this.subs = new SubtitleManager(
			this.dom.captionOverlay,
			this.dom.videoControls.captionSelect
		);

		this.audioUi = new AudioUiManager(
			this.dom.videoControls.audioTrackSelect,
			this.dom.videoControls.volumeControl,
			this.storage,
			this.audioElement
		);

		this.jellyfinClient = new JellyfinPlaybackClient();
		this.sourceFactory = new SourceFactory(this.jellyfinClient);
		this.audioPipeline = new AudioMsePipeline(this.audioElement, (message) => this._handlePipelineError(message));
		this.videoPipeline = new VideoCanvasPipeline(this.canvas, (message) => console.warn(message));

		this.state = STATE.IDLE;
		this.loaded = false;
		this.durationSec = 0;
		this.seekBaseSec = 0;
		this.currentSpeed = this.storage.getSpeed() || 1;
		this.sourceMode = SOURCE_MODE.DIRECT;
		this.sourceContext = null;
		this.sourceBundle = null;
		this.sessionId = 0;
		this.rebuffering = false;

		this.currentUrl = '';
		this.availableAudioTracks = [];
		this.selectedDirectTrackId = '';
		this.selectedAudioStreamIndex = null;
		this.selectedQuality = this.sourceFactory.normalizeQualityId(this.storage.getPreferredQualityId() || '720');

		this.draggingProgressBar = false;
		this.hideControlsTimeout = null;
		this.clickTimeout = null;
		this.skipIndicatorTimeout = null;

		this.TARGET_BUFFER_SECONDS = Math.max(1, Number(this.storage.getVideoBuffer()) || 30);
		this.AUTO_HIDE_DELAY_MS = 3000;

		this.historyRenderer = null;

		this.subs.setPlaybackTimeGetter(() => this.getPlaybackTime());
		this._bindEvents();

		this.changeSpeed(this.currentSpeed, {persist: false});
		this._syncQualityUi();
		this.updatePlayPauseIcon();
		this.audioUi.clearTracks();

		requestAnimationFrame(() => this._render());
	}

	setDependencies(deps) {
		this.historyRenderer = deps.historyRenderer;
	}

	get playing() {
		return this.state === STATE.PLAYING;
	}

	getPlaybackTime() {
		if(!this.loaded) return Math.max(0, this.seekBaseSec || 0);
		// Master clock: absolute timeline = seek base + native audio timeline.
		return Math.max(0, this.seekBaseSec + this.audioPipeline.getCurrentTime());
	}

	_syncVideoTimelineOffsetFromAudio() {
		const timelineOrigin = this.audioPipeline.getTimelineOriginSec();
		if(!Number.isFinite(timelineOrigin)) return;
		const offset = this.seekBaseSec - timelineOrigin;
		this.videoPipeline.setTimestampOffset(offset);
	}

	updatePlayPauseIcon() {
		if(this.dom.videoControls) {
			this.dom.videoControls.playing = this.playing;
		}
	}

	clearHideTimer() {
		if(this.hideControlsTimeout !== null) {
			clearTimeout(this.hideControlsTimeout);
			this.hideControlsTimeout = null;
		}
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
		if(!this.playing || this.draggingProgressBar) return;

		this.hideControlsTimeout = setTimeout(() => {
			if(this.playing && !this.draggingProgressBar) {
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
		if(!this.durationSec) {
			this.dom.videoControls?.setTime(0, 0);
			return;
		}

		const safe = Math.max(0, Math.min(seconds, this.durationSec));
		this.dom.videoControls?.setTime(safe, this.durationSec);
	}

	updateBufferedBar(currentSec) {
		if(!this.dom.videoControls?.progressBar || !this.durationSec || !this.loaded) return;

		const current = Math.max(0, Math.min(Number(currentSec) || 0, this.durationSec));
		const localCurrent = Math.max(0, this.audioPipeline.getCurrentTime());
		const localBufferedEnd = Math.max(localCurrent, this.audioPipeline.getBufferedEndFor(localCurrent));
		const rawBufferedEnd = this.seekBaseSec + localBufferedEnd;
		const cappedBufferedEnd = Math.min(this.durationSec, Math.min(rawBufferedEnd, current + this.TARGET_BUFFER_SECONDS));

		this.dom.videoControls.progressBar.setBuffered(current, cappedBufferedEnd);
	}

	resetBufferedBar(time = 0) {
		if(!this.dom.videoControls?.progressBar) return;
		const safe = Math.max(0, Number(time) || 0);
		this.dom.videoControls.progressBar.setBuffered(safe, safe);
	}

	_setUiPhase({state = null, rebuffering = null, controls = UI_CONTROLS_MODE.KEEP} = {}) {
		if(state) {
			this.state = state;
			this.updatePlayPauseIcon();
		}

		if(rebuffering !== null) {
			this.rebuffering = Boolean(rebuffering);
		}

		this._syncLoader();

		if(controls === UI_CONTROLS_MODE.AUTO_HIDE) {
			this.scheduleAutoHide();
			return;
		}
		if(controls === UI_CONTROLS_MODE.SHOW) {
			this.showControls();
		}
	}

	_syncLoader() {
		if(!this.loader) return;
		const show = this.state === STATE.LOADING || this.state === STATE.SEEKING || this.rebuffering;
		this.loader.classList.toggle('is-visible', show);
	}

	_bumpSession() {
		this.sessionId += 1;
		return this.sessionId;
	}

	_ensureCurrentSession(token) {
		return token === this.sessionId;
	}

	_returnIfStale(token) {
		return !this._ensureCurrentSession(token);
	}

	_isSessionCurrent(token) {
		return this._ensureCurrentSession(token);
	}

	_syncQualityUi() {
		const qualitySelect = this.dom.videoControls?.qualitySelect;
		if(!qualitySelect) return;

		if(this.sourceMode === SOURCE_MODE.JELLYFIN) {
			qualitySelect.show();
			qualitySelect.value = String(this.selectedQuality);
		} else {
			qualitySelect.hide();
		}
	}

	_getTimeoutForCurrentMode() {
		return this.sourceMode === SOURCE_MODE.JELLYFIN
			? FIRST_APPEND_TIMEOUT_JELLYFIN_MS
			: FIRST_APPEND_TIMEOUT_MS;
	}

	_clampToDuration(seconds) {
		const raw = Number(seconds) || 0;
		return Math.max(0, Math.min(raw, this.durationSec || 0));
	}

	_normalizeAutoPlayMode(mode) {
		return mode === AUTO_PLAY_MODE.PRESERVE ? AUTO_PLAY_MODE.PRESERVE : AUTO_PLAY_MODE.ALWAYS;
	}

	_shouldResumeAfterTransition(mode, wasPlaying) {
		return mode === AUTO_PLAY_MODE.ALWAYS ? true : Boolean(wasPlaying);
	}

	async _waitForAudioPriming(sessionToken, errorMessage) {
		const hasAudio = await this.audioPipeline.waitForFirstAppend(
			this._getTimeoutForCurrentMode(),
			sessionToken,
			(sid) => this._ensureCurrentSession(sid)
		);

		if(!hasAudio) {
			throw new Error(errorMessage);
		}
	}

	async _rebuildPlaybackAt(targetSec, sessionToken, options = {
		refreshSubtitles: false,
		firstAppendError: 'Audio pipeline did not produce initial data.'
	}) {
		await this.videoPipeline.stop();

		this.seekBaseSec = targetSec;
		await this._prepareSourceForStart(targetSec, {refreshSubtitles: Boolean(options.refreshSubtitles)});
		await this._startPipelines(targetSec, sessionToken);
		await this._waitForAudioPriming(sessionToken, options.firstAppendError || 'Audio pipeline did not produce initial data.');
	}

	_stateForTransition(mode) {
		return mode === TRANSITION_MODE.INITIAL_LOAD ? STATE.LOADING : STATE.SEEKING;
	}

	_logTransitionFailure(mode, error) {
		const labels = {
			[TRANSITION_MODE.INITIAL_LOAD]: 'Initial load',
			[TRANSITION_MODE.SEEK]: 'Seek',
			[TRANSITION_MODE.AUDIO_SWITCH]: 'Audio switch',
			[TRANSITION_MODE.QUALITY_SWITCH]: 'Quality switch',
		};
		console.error(`[Player] ${labels[mode] || 'Transition'} failed:`, error);
	}

	async _runTransition({
												 targetSec = 0,
												 mode = TRANSITION_MODE.SEEK,
												 refreshSubtitles = false,
												 autoPlayMode = AUTO_PLAY_MODE.ALWAYS,
												 firstAppendError = 'Audio pipeline did not produce initial data.',
												 persistProgress = true,
												 onBeforeRebuild = null,
												 onAfterSuccess = null,
												 onFailure = null,
											 }) {
		const target = mode === TRANSITION_MODE.INITIAL_LOAD
			? Math.max(0, Number(targetSec) || 0)
			: this._clampToDuration(targetSec);
		const wasPlaying = this.playing;
		const shouldResume = this._shouldResumeAfterTransition(
			this._normalizeAutoPlayMode(autoPlayMode),
			wasPlaying
		);

		const token = this._bumpSession();
		this._setUiPhase({
			state: this._stateForTransition(mode),
			rebuffering: true,
			controls: UI_CONTROLS_MODE.KEEP,
		});
		this.audioPipeline.pause();

		try {
			await this.videoPipeline.stop();
			if(this._returnIfStale(token)) return false;

			if(typeof onBeforeRebuild === 'function') {
				await onBeforeRebuild();
				if(this._returnIfStale(token)) return false;
			}

			await this._rebuildPlaybackAt(target, token, {
				refreshSubtitles,
				firstAppendError,
			});
			if(this._returnIfStale(token)) return false;
			this._syncVideoTimelineOffsetFromAudio();
			// Gate audio resume until we can draw a near-target frame to avoid "audio first, black screen".
			await this.videoPipeline.primeAt(target, {
				timeoutMs: VIDEO_PRIME_TIMEOUT_MS,
				maxLeadSec: 0.2,
			});
			if(this._returnIfStale(token)) return false;

			this.subs.seekTo(target);
			this.updateProgressBarTime(target);
			this.updateBufferedBar(target);
			if(persistProgress) this._persistPlaybackProgress(target);

			const canResume = shouldResume && (!this.durationSec || target < this.durationSec);
			if(canResume) {
				try {
					await this.audioPipeline.play();
					if(this._returnIfStale(token)) return false;
					this._setUiPhase({
						state: STATE.PLAYING,
						rebuffering: false,
						controls: UI_CONTROLS_MODE.AUTO_HIDE,
					});
				} catch(error) {
					if(mode === TRANSITION_MODE.INITIAL_LOAD) {
						this._setUiPhase({
							state: STATE.PAUSED,
							rebuffering: false,
							controls: UI_CONTROLS_MODE.SHOW,
						});
					} else {
						throw error;
					}
				}
			} else {
				this._setUiPhase({
					state: STATE.PAUSED,
					rebuffering: false,
					controls: UI_CONTROLS_MODE.SHOW,
				});
			}

			if(typeof onAfterSuccess === 'function') {
				onAfterSuccess(target);
			}
			return true;
		} catch(error) {
			if(this._returnIfStale(token)) return false;
			this._logTransitionFailure(mode, error);
			if(typeof onFailure === 'function') {
				onFailure(error);
				return false;
			}
			this._setUiPhase({
				state: STATE.PAUSED,
				rebuffering: false,
				controls: UI_CONTROLS_MODE.SHOW,
			});
			return false;
		}
	}

	_persistPlaybackProgress(timeSec) {
		if(!this.currentUrl) return;
		this.storage.savePlaybackPos(this.currentUrl, timeSec, this.durationSec);
		this.historyRenderer?.render();
	}

	_applyPausedUiState() {
		this._setUiPhase({
			state: STATE.PAUSED,
			rebuffering: false,
			controls: UI_CONTROLS_MODE.SHOW,
		});
	}

	_applyPlayingUiState() {
		this._setUiPhase({
			state: STATE.PLAYING,
			rebuffering: false,
			controls: UI_CONTROLS_MODE.AUTO_HIDE,
		});
	}

	async _prepareSourceForStart(startSeconds = 0, options = {refreshSubtitles: false}) {
		let bundle = null;

		if(this.sourceMode === SOURCE_MODE.DIRECT) {
			bundle = await this.sourceFactory.createDirectBundle({
				url: this.sourceContext.url,
				selectedTrackId: this.sourceContext.directAudioTrackId || '',
			});

			this.selectedDirectTrackId = bundle.selectedAudioTrackId;
			this.availableAudioTracks = bundle.audioTracks;
			this.sourceContext.directAudioTrackId = bundle.selectedAudioTrackId;
			this.audioUi.setDirectTracks(bundle.audioTracks, bundle.selectedAudioTrackId);
		} else {
			bundle = await this.sourceFactory.createJellyfinBundle({
				jellyfin: this.sourceContext.jellyfin,
				itemId: this.sourceContext.itemId,
				startSeconds,
				quality: this.sourceContext.quality || this.selectedQuality,
				audioStreamIndex: this.sourceContext.audioStreamIndex,
				videoCodec: this.sourceContext.videoCodec || 'h264',
			});

			this.selectedAudioStreamIndex = bundle.selectedAudioStreamIndex;
			this.availableAudioTracks = bundle.audioTracks;
			this.selectedQuality = this.sourceFactory.normalizeQualityId(bundle.selectedQuality || this.selectedQuality);

			this.sourceContext.mediaSourceId = bundle.mediaSourceId;
			this.sourceContext.playSessionId = bundle.playSessionId;
			this.sourceContext.audioStreamIndex = bundle.selectedAudioStreamIndex;
			this.sourceContext.quality = this.selectedQuality;

			this.audioUi.setJellyfinTracks(bundle.audioTracks, bundle.selectedAudioStreamIndex);
		}

		if(!(await canDecodeTrack(bundle.videoTrack))) {
			throw new Error('Video track cannot be decoded by current browser.');
		}

		this.sourceBundle = bundle;
		this.durationSec = bundle.durationSec;
		this.videoPipeline.configure(bundle.videoTrack);
		this._syncQualityUi();

		if(options.refreshSubtitles) {
			const inputTracks = await this.subs.collectTracks(bundle.input);
			const preferredSubtitleId = this._readStoredSubtitleSelection();
			this.subs.initTracks(inputTracks, bundle.subtitleTracks || [], preferredSubtitleId);

			if(this.currentUrl) {
				const manualCaptionUrl = this.storage.getManualCaptionUrl(this.currentUrl);
				if(manualCaptionUrl) {
					await this.subs.loadExternalFromUrl(manualCaptionUrl);
				}
			}
		}
	}

	_readStoredSubtitleSelection() {
		if(!this.currentUrl) return 'off';
		const id = this.storage.extractId(this.currentUrl);
		const historyItem = this.storage.getHistory().find((entry) => entry.id === id);
		return historyItem?.subtitleTrackId || 'off';
	}

	async _startPipelines(startAtSec, sessionToken) {
		if(!this.sourceBundle) throw new Error('Source is not prepared.');

		this.audioPipeline.start({
			audioTrack: this.sourceBundle.audioTrack,
			packetSink: this.sourceBundle.packetSink,
			startAtSec,
			sourceMode: this.sourceMode,
			sessionToken,
			isSessionCurrent: (token) => this._isSessionCurrent(token),
		});

		await this.videoPipeline.startAt(
			startAtSec,
			this.sourceMode,
			sessionToken,
			(token) => this._isSessionCurrent(token)
		);
	}

	async _stopPlaybackRuntime() {
		await this.videoPipeline.stop();
		this.audioPipeline.reset();
	}

	async _loadSource(context, options = {url: '', title: '', startTime: 0}) {
		const title = String(options.title || '').trim();
		const startTime = Math.max(0, Number(options.startTime) || 0);

		this.currentUrl = options.url || '';
		if(this.topBar) {
			this.topBar.setAttribute('video-title', title);
		}

		this.dom.setupScreen.classList.add('hidden');
		this.dom.playerScreen.classList.add('active');

		this.sourceMode = context.mode;
		this.sourceContext = {...context};
		this.loaded = false;

		try {
			await this._stopPlaybackRuntime();
			await this._runTransition({
				targetSec: startTime,
				mode: TRANSITION_MODE.INITIAL_LOAD,
				refreshSubtitles: true,
				autoPlayMode: AUTO_PLAY_MODE.ALWAYS,
				firstAppendError: 'Audio pipeline did not produce initial data.',
				persistProgress: false,
				onAfterSuccess: () => {
					this.loaded = true;
					this.resetBufferedBar(startTime);
				},
				onFailure: (error) => {
					this._handleFatalLoadError(error);
				},
			});
		} catch(error) {
			this._handleFatalLoadError(error);
		}
	}

	async play() {
		if(!this.loaded || !this.sourceBundle) return;

		const token = this.sessionId;

		try {
			if(!this.audioPipeline.isRunning()) {
				await this._startPipelines(this.seekBaseSec, token);
			}

			await this._waitForAudioPriming(token, 'Audio pipeline did not produce initial data.');
			if(this._returnIfStale(token)) return;

			await this.audioPipeline.play();
			if(this._returnIfStale(token)) return;

			this._applyPlayingUiState();
		} catch(error) {
			if(this._returnIfStale(token)) return;
			console.error('[Player] Play failed:', error);
			this._applyPausedUiState();
		}
	}

	pause(options = {saveProgress: true}) {
		if(!this.loaded && !this.playing) return;

		this.audioPipeline.pause();
		if(this.state !== STATE.PAUSED) {
			this._setUiPhase({
				state: STATE.PAUSED,
				rebuffering: false,
				controls: UI_CONTROLS_MODE.KEEP,
			});
		}

		if(options.saveProgress !== false) {
			this._persistPlaybackProgress(this.getPlaybackTime());
		}

		this.clearHideTimer();
		this.showControls();
	}

	async seekToTime(seconds, options = {autoPlay: AUTO_PLAY_MODE.ALWAYS}) {
		if(!this.loaded || !this.sourceBundle) return;
		await this._runTransition({
			targetSec: seconds,
			mode: TRANSITION_MODE.SEEK,
			refreshSubtitles: false,
			autoPlayMode: options.autoPlay,
			firstAppendError: 'Seek timed out before first audio append.',
			persistProgress: true,
		});
	}

	async _switchAudioTrack(payload) {
		if(!this.loaded || !this.sourceContext) return;

		const now = this.getPlaybackTime();
		const autoPlay = this.playing ? AUTO_PLAY_MODE.ALWAYS : AUTO_PLAY_MODE.PRESERVE;

		if(payload.mode === 'direct') {
			const nextId = String(payload.audioTrackId || '');
			if(!nextId || nextId === this.selectedDirectTrackId) return;

			this.sourceContext.directAudioTrackId = nextId;
			this.selectedDirectTrackId = nextId;
			await this._runTransition({
				targetSec: now,
				mode: TRANSITION_MODE.AUDIO_SWITCH,
				refreshSubtitles: false,
				autoPlayMode: autoPlay,
				firstAppendError: 'Audio switch timed out before first audio append.',
				persistProgress: true,
			});
			return;
		}

		if(payload.mode === 'jellyfin') {
			if(this.sourceMode !== SOURCE_MODE.JELLYFIN) return;
			const nextIndex = Number(payload.audioStreamIndex);
			if(!Number.isInteger(nextIndex) || nextIndex < 0) return;
			if(nextIndex === this.selectedAudioStreamIndex) return;

			this.sourceContext.audioStreamIndex = nextIndex;
			this.selectedAudioStreamIndex = nextIndex;
			await this._runTransition({
				targetSec: now,
				mode: TRANSITION_MODE.AUDIO_SWITCH,
				refreshSubtitles: false,
				autoPlayMode: autoPlay,
				firstAppendError: 'Audio switch timed out before first audio append.',
				persistProgress: true,
			});
		}
	}

	async switchQuality(rawQuality) {
		const nextQuality = this.sourceFactory.normalizeQualityId(rawQuality);
		this.selectedQuality = nextQuality;
		this.storage.savePreferredQualityId(nextQuality);
		this._syncQualityUi();

		if(!this.loaded || this.sourceMode !== SOURCE_MODE.JELLYFIN || !this.sourceContext) return;
		if(nextQuality === this.sourceContext.quality) return;

		this.sourceContext.quality = nextQuality;
		await this._runTransition({
			targetSec: this.getPlaybackTime(),
			mode: TRANSITION_MODE.QUALITY_SWITCH,
			refreshSubtitles: false,
			autoPlayMode: this.playing ? AUTO_PLAY_MODE.ALWAYS : AUTO_PLAY_MODE.PRESERVE,
			firstAppendError: 'Quality switch timed out before first audio append.',
			persistProgress: true,
		});
	}

	_updateSpeedUI(speed) {
		if(this.dom.videoControls?.speedSelect) {
			this.dom.videoControls.speedSelect.value = String(speed);
		}
	}

	changeSpeed(newSpeed, options = {persist: true}) {
		const speed = Number(newSpeed);
		if(!Number.isFinite(speed) || speed <= 0) return;

		this.currentSpeed = speed;
		this.audioPipeline.setPlaybackRate(speed, true);
		this._updateSpeedUI(speed);

		if(options.persist !== false) {
			this.storage.saveSpeed(speed);
		}
	}

	async loadVideo(videoUrl) {
		if(!videoUrl) return;

		const normalizedUrl = toHttpUrl(videoUrl);
		if(!normalizedUrl) return;

		this.app.dom.urlInput.value = '';
		this.app.closeModal('urlModal');

		const title = this.app.getVideoTitleFromUrl(normalizedUrl);
		this.storage.addHistory(normalizedUrl, title);
		const {time} = this.storage.getPlaybackPos(normalizedUrl);

		await this._loadSource({
			mode: SOURCE_MODE.DIRECT,
			url: normalizedUrl,
			directAudioTrackId: '',
			quality: this.selectedQuality,
		}, {
			url: normalizedUrl,
			title,
			startTime: time || 0,
		});
	}

	async loadJellyfinItem(jf, itemId, title, url, qualityStr) {
		const displayTitle = title || this.app.getVideoTitleFromUrl(url) || 'Jellyfin Video';
		this.currentUrl = url;

		const {time} = this.storage.getPlaybackPos(url);
		const preferredQuality = this.sourceFactory.normalizeQualityId(qualityStr || this.storage.getPreferredQualityId() || '720');
		const videoCodec = this.storage.getJellyfinVideoCodec() || 'h264';

		await this._loadSource({
			mode: SOURCE_MODE.JELLYFIN,
			jellyfin: jf,
			itemId,
			title: displayTitle,
			quality: preferredQuality,
			audioStreamIndex: null,
			videoCodec,
		}, {
			url,
			title: displayTitle,
			startTime: time || 0,
		});

		this.historyRenderer?.render();
	}

	async loadExternalCaptionUrl(captionUrl) {
		if(!this.loaded) {
			alert('Load video first.');
			return false;
		}

		const url = toHttpUrl(captionUrl);
		if(!url) return false;

		const success = await this.subs.loadExternalFromUrl(url);
		if(success && this.currentUrl) {
			this.storage.saveManualCaptionUrl(this.currentUrl, url);
		} else if(!success) {
			alert('Failed to load captions from this URL.');
		}

		return success;
	}

	async _stopEverythingForExit() {
		this._bumpSession();
		this.audioPipeline.pause();
		await this.videoPipeline.stop();
		this.audioPipeline.reset();
	}

	async exitPlayer() {
		this.pause({saveProgress: true});

		try {
			const dataUrl = this.canvas.toDataURL('image/jpeg', 0.5);
			this.storage.saveHistoryThumbnail(this.currentUrl, dataUrl);
		} catch(e) {
			console.warn('Could not save canvas thumbnail:', e);
		}

		this.historyRenderer?.render();
		this.dom.setupScreen.classList.remove('hidden');
		this.dom.playerScreen.classList.remove('active');

		await this._stopEverythingForExit();

		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.loaded = false;
		this.durationSec = 0;
		this.seekBaseSec = 0;
		this.sourceBundle = null;
		this.sourceContext = null;
		this.availableAudioTracks = [];
		this.selectedDirectTrackId = '';
		this.selectedAudioStreamIndex = null;

		this.subs.resetState();
		this.audioUi.clearTracks();
		this._setUiPhase({
			state: STATE.IDLE,
			rebuffering: false,
			controls: UI_CONTROLS_MODE.KEEP,
		});
	}

	_handleFatalLoadError(error) {
		console.error('Player initialization failed:', error);

		this.loaded = false;
		this.sourceBundle = null;
		this._setUiPhase({
			state: STATE.ERROR,
			rebuffering: false,
			controls: UI_CONTROLS_MODE.SHOW,
		});

		this.dom.playerScreen.classList.remove('active');
		this.dom.setupScreen.classList.remove('hidden');

		alert(`Playback failed: ${error?.message || error}`);
	}

	_handlePipelineError(message) {
		console.error('[Player]', message);
		this._setUiPhase({
			state: STATE.ERROR,
			rebuffering: false,
			controls: UI_CONTROLS_MODE.SHOW,
		});
	}

	_render() {
		if(this.loaded && this.dom.playerScreen.classList.contains('active')) {
			this._syncVideoTimelineOffsetFromAudio();
			const t = Math.max(0, Math.min(this.getPlaybackTime(), this.durationSec || Infinity));

			if(this.playing && this.durationSec && t >= this.durationSec) {
				this.pause({saveProgress: true});
				this.seekBaseSec = this.durationSec;
				this.updateProgressBarTime(this.durationSec);
			}

			if(!this.rebuffering) {
				this.videoPipeline.tick(t);
			}

			if(!this.draggingProgressBar) {
				this.updateProgressBarTime(t);
			}

			this.subs.renderAtTime(t);
			this.updateBufferedBar(t);
		}

		requestAnimationFrame(() => this._render());
	}

	_bindEvents() {
		this._bindControlEvents();
		this._bindGestureEvents();
		this._bindLifecycleEvents();
	}

	_bindControlEvents() {
		if(this.dom.videoControls) {
			this.dom.videoControls.addEventListener('action-skip', (e) => {
				const direction = e.detail > 0 ? 'forward' : 'backward';
				this._triggerSkipIndicator(direction);
				void this.seekToTime(this.getPlaybackTime() + e.detail, {autoPlay: AUTO_PLAY_MODE.ALWAYS});
			});

			this.dom.videoControls.addEventListener('action-play', () => {
				void this.play();
			});

			this.dom.videoControls.addEventListener('action-pause', () => {
				this.pause({saveProgress: true});
			});

			this.dom.videoControls.progressBar.addEventListener('seek-preview', (e) => {
				this.draggingProgressBar = true;
				this.updateProgressBarTime(e.detail);
			});

			this.dom.videoControls.progressBar.addEventListener('seek', (e) => {
				this.draggingProgressBar = false;
				void this.seekToTime(e.detail, {autoPlay: AUTO_PLAY_MODE.ALWAYS});
				this.scheduleAutoHide();
			});

			if(this.dom.videoControls.speedSelect) {
				this.dom.videoControls.speedSelect.addEventListener('change', (e) => {
					this.changeSpeed(e.detail.value);
				});
			}

			if(this.dom.videoControls.qualitySelect) {
				this.dom.videoControls.qualitySelect.value = this.selectedQuality;
				this.dom.videoControls.qualitySelect.addEventListener('change', (e) => {
					void this.switchQuality(e.detail.value);
				});
			}
		}
	}

	_bindGestureEvents() {
		let lastClickTime = 0;
		let lastClickPosition = '';

		this.dom.playerScreen.addEventListener('click', (e) => {
			if(e.target.closest('carplayer-video-controls') || e.target.closest('.player-topbar') || e.target.closest('.modal')) {
				return;
			}

			if(document.querySelector('carplayer-custom-select.is-open')) {
				return;
			}

			const screenWidth = window.innerWidth;
			const clickX = e.clientX;
			const third = screenWidth / 3;
			const now = Date.now();
			const delta = now - lastClickTime;

			let position = 'middle';
			if(clickX < third) position = 'left';
			else if(clickX > screenWidth - third) position = 'right';

			if(position === 'middle') {
				lastClickTime = 0;
				clearTimeout(this.clickTimeout);
				this._togglePlayPause();
				return;
			}

			if(delta < DOUBLE_TAP_WINDOW_MS && lastClickPosition === position) {
				clearTimeout(this.clickTimeout);
				if(position === 'left') {
					this._triggerSkipIndicator('backward');
					void this.seekToTime(this.getPlaybackTime() - SKIP_STEP_SECONDS, {autoPlay: AUTO_PLAY_MODE.ALWAYS});
				} else {
					this._triggerSkipIndicator('forward');
					void this.seekToTime(this.getPlaybackTime() + SKIP_STEP_SECONDS, {autoPlay: AUTO_PLAY_MODE.ALWAYS});
				}
				lastClickTime = 0;
				return;
			}

			lastClickTime = now;
			lastClickPosition = position;
			clearTimeout(this.clickTimeout);
			this.clickTimeout = setTimeout(() => {
				this._togglePlayPause();
			}, DOUBLE_TAP_WINDOW_MS);
		});

		this.dom.playerScreen.addEventListener('pointermove', () => this.showControls());
		this.dom.playerScreen.addEventListener('pointerdown', () => this.showControls());
		this.dom.playerScreen.addEventListener('mouseleave', () => {
			this.clearHideTimer();
			if(this.playing && !this.draggingProgressBar) {
				this.setControlsIdleState(true);
			}
		});
	}

	_bindLifecycleEvents() {
		this.topBar?.addEventListener('back', () => {
			if(this.dom.playerScreen.classList.contains('active')) {
				void this.exitPlayer();
			}
		});

		this.subs.onTrackSelected = (selectedValue) => {
			if(this.currentUrl) {
				this.storage.updateHistoryItem(this.currentUrl, {subtitleTrackId: selectedValue});
			}
		};

		this.audioUi.onTrackSelected = (payload) => {
			void this._switchAudioTrack(payload);
		};

		this.audioElement.addEventListener('ended', () => {
			if(!this.loaded) return;
			this.pause({saveProgress: true});
			this.seekBaseSec = this.durationSec;
			this.updateProgressBarTime(this.durationSec);
		});

		this.dom.btnBack?.addEventListener('click', () => {
			void this.exitPlayer();
		});
	}

	_togglePlayPause() {
		if(this.playing) {
			this.pause({saveProgress: true});
			return;
		}
		void this.play();
	}

	_triggerSkipIndicator(direction) {
		if(!this.dom.skipIndicator) return;

		clearTimeout(this.skipIndicatorTimeout);
		this.dom.skipIndicator.classList.remove('is-visible', 'skip-indicator--left', 'skip-indicator--right');

		setTimeout(() => {
			const skipClass = direction === 'backward' ? 'skip-indicator--left' : 'skip-indicator--right';
			this.dom.skipIndicator.classList.add(skipClass);
			this.dom.skipIndicator.innerHTML = direction === 'backward'
				? '<span class="skip-text">&lt;&lt; -10s</span>'
				: '<span class="skip-text">+10s &gt;&gt;</span>';
			this.dom.skipIndicator.classList.add('is-visible');

			this.skipIndicatorTimeout = setTimeout(() => {
				this.dom.skipIndicator.classList.remove('is-visible');
			}, SKIP_INDICATOR_HIDE_MS);
		}, 10);
	}
}
