// Mediabunny (about 780 KB) loads on the first playback, not with the app, so the dashboard opens faster on the
// car's LTE. Every playback path awaits loadMediabunny() before it touches `MB`.
let MB = null;
let mediabunnyPromise = null;

export function loadMediabunny() {
	mediabunnyPromise ??= import('mediabunny')
		.then((module) => {
			MB = module;
			return module;
		})
		.catch((error) => {
			mediabunnyPromise = null;
			throw new Error(`Could not load the video library: ${error?.message || error}`);
		});
	return mediabunnyPromise;
}

const DOLBY_CODECS = ['ac3', 'eac3'];
const AC3_PLUGIN_URL = 'https://cdn.jsdelivr.net/npm/@mediabunny/ac3@1.66.2/dist/bundles/mediabunny-ac3.min.mjs';
let ac3DecoderPromise = null;

/**
 * How the audio pipeline can play a track: 'mp4' (fragmented MP4 as is), 'mp3' (raw MP3 frames, for browsers that
 * reject MP3 in MP4), 'transcode' (AC-3/E-AC-3 decoded in WASM and re-encoded, CPU heavy, last resort) or null.
 */
async function getAudioPlayback(track) {
	const codec = await track.getCodec();
	const codecString = await track.getCodecParameterString();
	const mp4Mime = codecString ? `audio/mp4; codecs="${codecString}"` : '';
	if(mp4Mime && MediaSource.isTypeSupported(mp4Mime)) return {mode: 'mp4', mime: mp4Mime};
	if(codec === 'mp3' && MediaSource.isTypeSupported('audio/mpeg')) return {mode: 'mp3', mime: 'audio/mpeg'};
	if(DOLBY_CODECS.includes(codec)) return {mode: 'transcode', mime: ''};
	return null;
}

/** Loads the AC-3/E-AC-3 WASM decoder (about 1.2 MB) only when a stream has no other playable audio. */
function loadAc3Decoder() {
	ac3DecoderPromise ??= import(AC3_PLUGIN_URL)
		.then((module) => module.registerAc3Decoder())
		.catch((error) => {
			ac3DecoderPromise = null;
			throw new Error(`Could not load the Dolby audio decoder: ${error?.message || error}`);
		});
	return ac3DecoderPromise;
}

/** First codec this browser can both encode with WebCodecs and play through MSE. */
async function pickTranscodeTarget() {
	const candidates = [
		{codec: 'aac', mime: 'audio/mp4; codecs="mp4a.40.2"'},
		{codec: 'opus', mime: 'audio/mp4; codecs="opus"'},
	];
	for(const candidate of candidates) {
		if(!MediaSource.isTypeSupported(candidate.mime)) continue;
		const encodable = await MB.getFirstEncodableAudioCodec([candidate.codec], {numberOfChannels: 2, sampleRate: 48000, quality: MB.QUALITY_MEDIUM});
		if(encodable) return candidate;
	}
	return null;
}

/**
 * Reads an HLS master playlist and returns the variant to play: the tallest one up to 720p, else the smallest one,
 * else (no RESOLUTION) the richest. Returns '' for a media playlist, or, unless `allowSeparateAudio`, for a master
 * whose audio lives in its own renditions (opening one variant alone would then lose the sound).
 */
async function pickHlsVariantUrl(masterUrl, {allowSeparateAudio = true} = {}) {
	const response = await fetch(masterUrl);
	if(!response.ok) return '';
	const text = await response.text();
	if(!allowSeparateAudio && /#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI=/i.test(text)) return '';
	const lines = text.split(/\r?\n/).map((line) => line.trim());
	const variants = [];
	lines.forEach((line, index) => {
		if(!line.startsWith('#EXT-X-STREAM-INF')) return;
		const uri = lines.slice(index + 1).find((next) => next && !next.startsWith('#'));
		if(!uri) return;
		variants.push({
			url: new URL(uri, response.url || masterUrl).href,
			height: Number(line.match(/RESOLUTION=\d+x(\d+)/i)?.[1]) || 0,
			bandwidth: Number(line.match(/[^-]BANDWIDTH=(\d+)/i)?.[1]) || 0,
		});
	});
	const sized = variants.filter((variant) => variant.height > 0);
	const fitting = sized.filter((variant) => variant.height <= 720);
	if(fitting.length) return fitting.sort((a, b) => (b.height - a.height) || (b.bandwidth - a.bandwidth))[0].url;
	if(sized.length) return sized.sort((a, b) => (a.height - b.height) || (a.bandwidth - b.bandwidth))[0].url;
	return variants.sort((a, b) => b.bandwidth - a.bandwidth)[0]?.url || '';
}

/** @typedef {'idle'|'loading'|'ready'|'playing'|'paused'|'seeking'|'error'} AppState */
/** @typedef {'direct'|'jellyfin'} SourceMode */
/** @typedef {'360'|'480'|'720'|'1080'|'direct'} QualityId */
/**
 * @typedef {Object} PlaybackContext
 * @property {SourceMode} mode
 * @property {string=} url
 * @property {Object=} jellyfin
 * @property {string=} itemId
 * @property {string=} title
 * @property {string=} videoCodec
 * @property {string=} directAudioTrackId
 * @property {number|null=} audioStreamIndex
 * @property {QualityId=} quality
 * @property {string|null=} mediaSourceId
 * @property {string|null=} playSessionId
 */
/**
 * @typedef {Object} JellyfinAudioTrack
 * @property {number} index
 * @property {string} label
 * @property {string} language
 */
/**
 * @typedef {Object} SourceBundle
 * @property {Input} input
 * @property {number} durationSec
 * @property {*} videoTrack
 * @property {*} audioTrack
 * @property {EncodedPacketSink} packetSink
 * @property {Array<{id:string,label:string,index:number,language:string}>} audioTracks
 * @property {string} selectedAudioTrackId
 * @property {number|null} selectedAudioStreamIndex
 * @property {QualityId} selectedQuality
 * @property {string|null} mediaSourceId
 * @property {string|null} playSessionId
 * @property {Array<{id:string,name:string,externalUrl:string}>} subtitleTracks
 */

export const STATE = Object.freeze({
	IDLE: 'idle',
	LOADING: 'loading',
	READY: 'ready',
	PLAYING: 'playing',
	PAUSED: 'paused',
	SEEKING: 'seeking',
	ERROR: 'error',
});

export const SOURCE_MODE = Object.freeze({
	DIRECT: 'direct',
	JELLYFIN: 'jellyfin',
});

export const QUALITY_PROFILE_MAP = Object.freeze({
	'360': {
		id: '360',
		label: '360p',
		maxHeight: 360,
		maxWidth: 640,
		videoBitrate: 900000,
		audioBitrate: 128000,
		maxStreamingBitrate: 1200000,
	},
	'480': {
		id: '480',
		label: '480p',
		maxHeight: 480,
		maxWidth: 854,
		videoBitrate: 2500000,
		audioBitrate: 160000,
		maxStreamingBitrate: 2700000,
	},
	'720': {
		id: '720',
		label: '720p',
		maxHeight: 720,
		maxWidth: 1280,
		videoBitrate: 4500000,
		audioBitrate: 192000,
		maxStreamingBitrate: 4800000,
	},
	'1080': {
		id: '1080',
		label: '1080p',
		maxHeight: 1080,
		maxWidth: 1920,
		videoBitrate: 8000000,
		audioBitrate: 192000,
		maxStreamingBitrate: 8400000,
	},
	direct: {
		id: 'direct',
		label: 'direct',
		maxHeight: null,
		maxWidth: null,
		videoBitrate: 20000000,
		audioBitrate: 256000,
		maxStreamingBitrate: 22000000,
	},
});

export function getTrackId(track) {
	const id = track?.id;
	if(id === null || id === undefined) return '';
	return String(id).trim();
}

function toBytes(data) {
	if(data instanceof Uint8Array) return new Uint8Array(data);
	if(data instanceof ArrayBuffer) return new Uint8Array(data);
	return new Uint8Array(data.buffer || data);
}

function concatBytes(parts) {
	const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	parts.forEach((part) => {
		out.set(part, offset);
		offset += part.byteLength;
	});
	return out;
}

// Sync track getters are deprecated and may throw for HLS tracks whose metadata is not loaded yet.
function readSync(read) {
	try {
		return read();
	} catch {
		return undefined;
	}
}

function buildDirectAudioLabel(track, idx) {
	const name = String(readSync(() => track?.name) || '').trim();
	if(name) return name;

	const language = String(readSync(() => track?.language) || '').trim().toUpperCase();
	const codec = String(readSync(() => track?.codec) || '').trim().toUpperCase();
	const channels = Number(readSync(() => track?.numberOfChannels) ?? track?.channels);
	const channelsText = Number.isFinite(channels) && channels > 0 ? `${channels}ch` : '';

	const parts = [language, codec, channelsText].filter(Boolean);
	return parts.length ? parts.join(' ') : `Audio ${idx + 1}`;
}

function buildJellyfinAudioLabel(stream) {
	const title = String(stream?.title || '').trim();
	if(title) return title;

	const language = String(stream?.language || '').trim().toUpperCase();
	const codec = String(stream?.codec || '').trim().toUpperCase();
	const channels = Number(stream?.channels);
	const channelsText = Number.isFinite(channels) && channels > 0 ? `${channels}ch` : '';

	const parts = [language, codec, channelsText].filter(Boolean);
	return parts.length ? parts.join(' ') : `Audio ${Number(stream?.index) || 0}`;
}

export class JellyfinPlaybackClient {
	buildUrl(baseUrl, pathOrUrl, params = null) {
		const base = String(baseUrl || '').trim();
		const raw = String(pathOrUrl || '').trim();
		const url = raw.startsWith('http://') || raw.startsWith('https://')
			? new URL(raw)
			: new URL(raw.replace(/^\/+/, ''), `${base.replace(/\/+$/, '')}/`);

		if(params) {
			Object.entries(params).forEach(([key, value]) => {
				if(value === undefined || value === null || value === '') return;
				url.searchParams.set(key, String(value));
			});
		}

		return url;
	}

	resolveUrl(relative, baseRef) {
		try {
			return new URL(relative, baseRef).href;
		} catch {
			return relative;
		}
	}

	async fetchRaw(jf, pathOrUrl, options = {}) {
		const target = String(pathOrUrl || '');
		const url = target.startsWith('http://') || target.startsWith('https://')
			? target
			: this.buildUrl(jf.baseUrl, target).toString();
		return jf.fetchRaw(url, options);
	}

	async fetchText(jf, pathOrUrl, options = {}) {
		const res = await this.fetchRaw(jf, pathOrUrl, options);
		if(!res.ok) throw new Error(`Jellyfin request ${res.status} for ${pathOrUrl}`);
		return res.text();
	}

	async resolveM3u8VariantAndSegments(jf, masterText, masterUrl) {
		const lines = String(masterText || '').split('\n').map((x) => x.trim()).filter(Boolean);
		const hasDirectMedia = lines.some((line) => line.startsWith('#EXTINF'));

		let mediaUrl = masterUrl;
		let mediaText = masterText;

		if(!hasDirectMedia) {
			const firstVariant = lines.find((line) => !line.startsWith('#'));
			if(!firstVariant) throw new Error('HLS master playlist has no variant entries.');
			mediaUrl = this.resolveUrl(firstVariant, masterUrl);
			mediaText = await this.fetchText(jf, mediaUrl);
		}

		const mediaLines = String(mediaText || '').split('\n').map((x) => x.trim());
		const segments = [];
		const segmentDurations = [];
		let targetDuration = 3;
		let pendingDuration = null;

		for(const line of mediaLines) {
			if(!line) continue;
			if(line.startsWith('#EXT-X-TARGETDURATION:')) {
				const value = Number(line.split(':')[1]);
				if(Number.isFinite(value) && value > 0) targetDuration = value;
				continue;
			}
			if(line.startsWith('#EXTINF:')) {
				const rawDur = line.slice('#EXTINF:'.length).split(',')[0];
				const parsedDur = Number(rawDur);
				pendingDuration = Number.isFinite(parsedDur) && parsedDur > 0 ? parsedDur : null;
				continue;
			}
			if(line.startsWith('#')) continue;
			segments.push(this.resolveUrl(line, mediaUrl));
			segmentDurations.push(pendingDuration ?? targetDuration);
			pendingDuration = null;
		}

		return {mediaUrl, targetDuration, segments, segmentDurations};
	}
}

export class SourceFactory {
	#jellyfinClient;

	constructor(jellyfinClient) {
		this.#jellyfinClient = jellyfinClient;
	}

	normalizeQualityId(value) {
		const id = String(value || '').trim().toLowerCase();
		if(id === '360' || id === '480' || id === '720' || id === '1080' || id === 'direct') return id;
		return '720';
	}

	getQualityProfile(qualityId) {
		return QUALITY_PROFILE_MAP[this.normalizeQualityId(qualityId)] || QUALITY_PROFILE_MAP['720'];
	}

	async createDirectBundle({url, selectedTrackId = ''}) {
		await loadMediabunny();
		const {input, videoTrack} = await this.#openDirectInput(url);
		const pairableAudioTrack = typeof videoTrack?.getPrimaryPairableAudioTrack === 'function'
			? await videoTrack.getPrimaryPairableAudioTrack()
			: null;
		const primaryAudioTrack = pairableAudioTrack || await input.getPrimaryAudioTrack();

		const isLive = typeof videoTrack?.isLive === 'function' ? await videoTrack.isLive() : false;
		let durationSec = 0;
		let liveStartSec = 0;
		if(isLive) {
			// Live playlists never end, so computeDuration() would wait forever.
			const knownDuration = Number(await videoTrack.getDurationFromMetadata({skipLiveWait: true})) || 0;
			const refreshInterval = Number(await videoTrack.getLiveRefreshInterval()) || 4;
			liveStartSec = Math.max(0, knownDuration - 2 * refreshInterval);
		} else {
			durationSec = await input.computeDuration();
		}

		const allAudio = typeof input.getAudioTracks === 'function'
			? ((await input.getAudioTracks()) || [])
			: (primaryAudioTrack ? [primaryAudioTrack] : []);

		const dedupedAudio = [];
		const seenIds = new Set();
		allAudio.forEach((track) => {
			if(!track) return;
			const trackId = getTrackId(track);
			if(trackId && seenIds.has(trackId)) return;
			if(trackId) seenIds.add(trackId);
			dedupedAudio.push(track);
		});

		const audioTracks = dedupedAudio.map((track, index) => ({
			id: getTrackId(track) || `direct-${index}`,
			label: buildDirectAudioLabel(track, index),
			index,
			language: String(readSync(() => track?.language) || ''),
			_track: track,
		}));

		let selected = null;
		if(selectedTrackId) {
			selected = audioTracks.find((entry) => entry.id === selectedTrackId) || null;
		}

		if(!selected && primaryAudioTrack) {
			const primaryId = getTrackId(primaryAudioTrack);
			selected = audioTracks.find((entry) => entry.id === primaryId) || null;
		}

		if(!selected) selected = audioTracks[0] || null;

		// Automatic choice only: prefer a track the browser plays directly; Dolby decoding is the last resort.
		const explicitChoice = Boolean(selectedTrackId) && selected?.id === selectedTrackId;
		if(!explicitChoice && selected) {
			const rank = async(entry) => {
				const playback = await getAudioPlayback(entry._track).catch(() => null);
				return !playback ? 2 : (playback.mode === 'transcode' ? 1 : 0);
			};
			if(await rank(selected) > 0) {
				for(const entry of audioTracks) {
					if(await rank(entry) === 0) {
						selected = entry;
						break;
					}
				}
			}
		}
		const audioTrack = selected?._track || primaryAudioTrack;

		if(!videoTrack) throw new Error('No video track found in source.');
		if(!audioTrack) throw new Error('No audio track found in source.');

		return {
			input,
			durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0,
			isLive,
			liveStartSec,
			videoTrack,
			audioTrack,
			packetSink: new MB.EncodedPacketSink(audioTrack),
			audioTracks: audioTracks.map(({_track, ...rest}) => rest),
			selectedAudioTrackId: selected?.id || '',
			selectedAudioStreamIndex: null,
			selectedQuality: '720',
			mediaSourceId: null,
			playSessionId: null,
			subtitleTracks: [],
		};
	}

	async createJellyfinBundle({
															 jellyfin,
															 itemId,
															 startSeconds = 0,
															 quality = '720',
															 audioStreamIndex = null,
															 videoCodec = 'h264',
														 }) {
		await loadMediabunny();
		const qualityProfile = this.getQualityProfile(quality);

		const pbData = await jellyfin.getPlaybackInfo(itemId, {
			startSeconds: 0,
			mediaSourceId: null,
			audioIndex: Number.isInteger(audioStreamIndex) ? audioStreamIndex : null,
		});

		const sourceAudioTracks = this.#collectJellyfinAudioTracks(pbData.streams || []);

		let selectedTrack = null;
		if(Number.isInteger(audioStreamIndex)) {
			selectedTrack = sourceAudioTracks.find((track) => track.index === audioStreamIndex) || null;
		}
		if(!selectedTrack) selectedTrack = sourceAudioTracks[0] || null;
		const selectedTrackIndex = selectedTrack ? selectedTrack.index : null;
		const query = this.#buildJellyfinPlaybackQuery({
			qualityProfile,
			audioStreamIndex: selectedTrackIndex,
			videoCodec,
			startSeconds: 0,
			mediaSourceId: pbData.mediaSourceId || null,
			playSessionId: pbData.playSessionId || null,
			apiKey: jellyfin.apiKey,
		});
		const playlist = await this.#resolveJellyfinPlaylist({
			jellyfin,
			itemId,
			pbData,
			query,
			qualityProfile,
			selectedTrackIndex,
			videoCodec,
		});

		if(!playlist.segments.length) {
			throw new Error('HLS playlist has no segments.');
		}

		const startIndex = this.#findStartSegmentIndex(playlist, Number(startSeconds) || 0);
		const stream = this.#buildSegmentReadableStream({
			jellyfin,
			playlist,
			startSegmentIndex: startIndex,
		});

		const input = new MB.Input({
			source: new MB.ReadableStreamSource(stream, {maxCacheSize: 256 * 1024 * 1024}),
			formats: [MB.MPEG_TS],
		});

		const videoTrack = await input.getPrimaryVideoTrack();
		const audioTrack = await input.getPrimaryAudioTrack();

		if(!videoTrack) throw new Error('No video track found in source.');
		if(!audioTrack) throw new Error('No audio track found in source.');

		const durationSec = Number(pbData.runTimeTicks || 0) / 10000000;

		const subtitleTracks = this.#collectJellyfinSubtitleTracks(
			pbData.streams || [],
			jellyfin,
			itemId,
			pbData.mediaSourceId || null
		);

		return {
			input,
			durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0,
			videoTrack,
			audioTrack,
			packetSink: new MB.EncodedPacketSink(audioTrack),
			audioTracks: sourceAudioTracks.map((track) => ({
				id: String(track.index),
				label: track.label,
				index: track.index,
				language: track.language,
			})),
			selectedAudioTrackId: '',
			selectedAudioStreamIndex: selectedTrackIndex,
			selectedQuality: qualityProfile.id,
			mediaSourceId: pbData.mediaSourceId || null,
			playSessionId: pbData.playSessionId || null,
			subtitleTracks,
		};
	}

	async #openDirectInput(url) {
		// While starting, a failing request gives up after two retries so offline or dead links show an error instead
		// of loading forever; once playing, retries continue (with backoff) to ride out short LTE drops.
		const retry = {starting: true};
		const open = (sourceUrl) => new MB.Input({
			source: new MB.UrlSource(sourceUrl, {
				getRetryDelay: (previousAttempts) => (retry.starting && previousAttempts >= 2 ? null : Math.min(2 ** previousAttempts, 8)),
			}),
			// HLS_FORMATS lets the same path play .m3u8 playlists (IPTV, live streams).
			formats: [...new Set([...MB.ALL_FORMATS, ...MB.HLS_FORMATS])],
		});
		const opened = async(input) => {
			const videoTrack = await this.#pickVideoTrack(input);
			retry.starting = false;
			return {input, videoTrack};
		};

		// For a master playlist with muxed audio, open the chosen variant directly: asking Mediabunny for every
		// variant's size downloads test segments of all of them before the first frame (about 25 s on slow LTE).
		let startUrl = url;
		if(/\.m3u8?$/i.test(new URL(url, location.href).pathname)) {
			startUrl = await pickHlsVariantUrl(url, {allowSeparateAudio: false}).catch(() => '') || url;
		}

		const input = open(startUrl);
		try {
			return await opened(input);
		} catch (error) {
			// A master playlist without CODECS makes Mediabunny read the segments, and an IPTV stream with two audio
			// tracks (e.g. MP3 + E-AC-3) is then rejected. Opened directly, the variant playlist plays fine.
			if(!/(multiple|several) (audio|video) codecs/i.test(String(error?.message))) throw error;
			input.dispose?.();
			const variantUrl = await pickHlsVariantUrl(url);
			if(!variantUrl) throw error;
			return opened(open(variantUrl));
		}
	}

	async #pickVideoTrack(input) {
		const videoTracks = typeof input.getVideoTracks === 'function' ? ((await input.getVideoTracks()) || []) : [];
		if(videoTracks.length <= 1) return videoTracks[0] || input.getPrimaryVideoTrack();

		// HLS master playlists expose one track per variant; car CPUs and LTE prefer <= 720p.
		const withHeight = await Promise.all(videoTracks.map(async(track) => ({
			track,
			height: Number(await track.getDisplayHeight()) || 0,
		})));
		withHeight.sort((a, b) => b.height - a.height);
		const fitting = withHeight.find((entry) => entry.height > 0 && entry.height <= 720);
		return (fitting || withHeight[withHeight.length - 1]).track;
	}

	#buildJellyfinPlaybackQuery({
																qualityProfile,
																audioStreamIndex,
																videoCodec,
																startSeconds = 0,
																mediaSourceId = null,
																playSessionId = null,
																apiKey = '',
															}) {
		const query = {
			ApiKey: String(apiKey || ''),
			startTimeTicks: String(Math.max(0, Math.floor(Number(startSeconds || 0) * 10000000))),
			ManifestName: 'main',
			SegmentContainer: 'ts',
			MinSegments: '1',
			BreakOnNonKeyFrames: 'true',
			VideoCodec: videoCodec || 'h264',
			AudioCodec: 'aac',
			AudioChannels: '2',
			VideoBitrate: String(qualityProfile.videoBitrate),
			AudioBitrate: String(qualityProfile.audioBitrate),
			MaxStreamingBitrate: String(qualityProfile.maxStreamingBitrate),
		};

		if(qualityProfile.maxHeight) query.maxHeight = String(qualityProfile.maxHeight);
		if(qualityProfile.maxWidth) query.maxWidth = String(qualityProfile.maxWidth);
		if(mediaSourceId) query.MediaSourceId = String(mediaSourceId);
		if(playSessionId) query.PlaySessionId = String(playSessionId);
		if(audioStreamIndex !== null && audioStreamIndex !== undefined) {
			query.AudioStreamIndex = String(audioStreamIndex);
		}

		return query;
	}

	async #resolveJellyfinPlaylist({
																	 jellyfin,
																	 itemId,
																	 pbData,
																	 query,
																	 qualityProfile,
																	 selectedTrackIndex,
																	 videoCodec,
																 }) {
		let masterRef = pbData.transcodingUrl || '';
		if(!masterRef) {
			const h = qualityProfile.maxHeight || 1080;
			masterRef = jellyfin.getHlsUrl(itemId, {
				mediaSourceId: pbData.mediaSourceId || null,
				height: h,
				startSeconds: 0,
				audioIndex: selectedTrackIndex,
				playSessionId: pbData.playSessionId || null,
				videoCodec,
			});
		}

		const masterUrl = this.#jellyfinClient.buildUrl(jellyfin.baseUrl, masterRef);
		Object.entries(query).forEach(([key, value]) => {
			if(value === undefined || value === null || value === '') return;
			masterUrl.searchParams.set(key, String(value));
		});

		const masterText = await this.#jellyfinClient.fetchText(jellyfin, masterUrl.toString());
		return this.#jellyfinClient.resolveM3u8VariantAndSegments(
			jellyfin,
			masterText,
			masterUrl.toString()
		);
	}

	#buildSegmentReadableStream({jellyfin, playlist, startSegmentIndex}) {
		const segments = playlist.segments;
		let segmentIndex = Math.max(0, Number(startSegmentIndex) || 0);

		return new ReadableStream({
			pull: async(controller) => {
				if(segmentIndex >= segments.length) {
					controller.close();
					return;
				}

				const segmentUrl = segments[segmentIndex++];
				let res = null;

				for(let attempt = 0; attempt < 4; attempt++) {
					res = await this.#jellyfinClient.fetchRaw(jellyfin, segmentUrl);
					if(res.ok) break;
					if([400, 404, 500].includes(res.status)) {
						await this.#delay(900 + attempt * 700);
						continue;
					}
					break;
				}

				if(!res?.ok) {
					controller.error(new Error(`Jellyfin segment fetch failed: ${res?.status || 'network'}`));
					return;
				}

				controller.enqueue(new Uint8Array(await res.arrayBuffer()));
			},
		});
	}

	#collectJellyfinAudioTracks(mediaStreams) {
		return (mediaStreams || [])
			.filter((stream) => String(stream?.type || '').toLowerCase() === 'audio')
			.map((stream) => ({
				index: Number(stream.index),
				label: buildJellyfinAudioLabel(stream),
				language: String(stream.language || ''),
			}))
			.filter((track) => Number.isInteger(track.index) && track.index >= 0);
	}

	#collectJellyfinSubtitleTracks(mediaStreams, jellyfin, itemId, mediaSourceId) {
		return (mediaStreams || [])
			.filter((stream) => String(stream?.type || '').toLowerCase() === 'subtitle')
			.map((stream) => ({
				id: `jf-sub-${stream.index}`,
				name: String(stream.title || stream.language || `Subtitle ${stream.index}`),
				externalUrl: jellyfin.getSubtitleUrl(itemId, mediaSourceId, stream.index),
			}));
	}

	#findStartSegmentIndex(playlist, startSeconds) {
		const totalSegments = Array.isArray(playlist?.segments) ? playlist.segments.length : 0;
		if(!totalSegments) return 0;

		const target = Math.max(0, Number(startSeconds) || 0);
		if(target <= 0) return 0;

		const durations = Array.isArray(playlist.segmentDurations) ? playlist.segmentDurations : [];
		const fallbackDuration = Number(playlist.targetDuration) > 0 ? Number(playlist.targetDuration) : 3;

		if(durations.length !== totalSegments) {
			return Math.min(totalSegments - 1, Math.max(0, Math.floor(target / fallbackDuration)));
		}

		let acc = 0;
		for(let i = 0; i < durations.length; i++) {
			const dur = Number.isFinite(durations[i]) && durations[i] > 0 ? durations[i] : fallbackDuration;
			if(target < acc + dur) return i;
			acc += dur;
		}

		return totalSegments - 1;
	}

	#delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

export class AudioMsePipeline {
	#audio;
	#onError;

	#mediaSource;
	#sourceBuffer;
	#audioObjectUrl;

	#appendQueue;
	#appendQueueBytes;
	#appendChain;
	#flushRunning;

	#firstAppendDone;
	#resolveFirstAppend;
	#firstAppendPromise;

	#transmuxPromise;
	#currentSpeed;
	#timelineOriginSec;

	constructor(audioElement, onError) {
		this.#audio = audioElement;
		this.#onError = onError;

		this.#mediaSource = null;
		this.#sourceBuffer = null;
		this.#audioObjectUrl = null;

		this.#appendQueue = [];
		this.#appendQueueBytes = 0;
		this.#appendChain = Promise.resolve();
		this.#flushRunning = false;

		this.#firstAppendDone = false;
		this.#resolveFirstAppend = null;
		this.#firstAppendPromise = Promise.resolve(false);

		this.#transmuxPromise = null;
		this.#currentSpeed = 1;
		this.#timelineOriginSec = null;
	}

	isRunning() {
		return this.#transmuxPromise !== null;
	}

	setPlaybackRate(rate, preservePitch = true) {
		const speed = Number(rate);
		if(!Number.isFinite(speed) || speed <= 0) return;

		this.#currentSpeed = speed;
		this.#audio.playbackRate = speed;

		if(preservePitch) {
			this.#audio.preservesPitch = true;
			this.#audio.mozPreservesPitch = true;
			this.#audio.webkitPreservesPitch = true;
		}
	}

	pause() {
		this.#audio.pause();
	}

	async play() {
		await this.#audio.play();
	}

	getCurrentTime() {
		return this.#audio.currentTime || 0;
	}

	getTimelineOriginSec() {
		return Number.isFinite(this.#timelineOriginSec) ? this.#timelineOriginSec : null;
	}

	getBufferedAheadSeconds() {
		if(!this.#audio.buffered || this.#audio.buffered.length === 0) return 0;
		const end = this.#audio.buffered.end(this.#audio.buffered.length - 1);
		return Math.max(0, end - (this.#audio.currentTime || 0));
	}

	getBufferedEndFor(timeSec) {
		if(!this.#audio.buffered || this.#audio.buffered.length === 0) return Math.max(0, Number(timeSec) || 0);

		const t = Math.max(0, Number(timeSec) || 0);
		for(let i = 0; i < this.#audio.buffered.length; i++) {
			const start = this.#audio.buffered.start(i);
			const end = this.#audio.buffered.end(i);
			if(t >= start - 0.08 && t <= end + 0.08) return end;
			if(t < start) break;
		}

		return t;
	}

	async waitForFirstAppend(timeoutMs, sessionToken, isSessionCurrent) {
		if(!isSessionCurrent(sessionToken)) return false;
		if(this.#firstAppendDone) return true;

		return Promise.race([
			this.#firstAppendPromise,
			new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
		]);
	}

	reset() {
		this.#appendQueue = [];
		this.#appendQueueBytes = 0;
		this.#appendChain = Promise.resolve();
		this.#flushRunning = false;

		this.#firstAppendDone = false;
		this.#firstAppendPromise = new Promise((resolve) => {
			this.#resolveFirstAppend = resolve;
		});

		this.#sourceBuffer = null;
		this.#mediaSource = null;
		this.#timelineOriginSec = null;

		this.#audio.pause();
		this.#audio.removeAttribute('src');
		this.#audio.load();
		this.#revokeAudioObjectUrl();
	}

	start({audioTrack, packetSink, startAtSec, sourceMode, sessionToken, isSessionCurrent}) {
		this.#transmuxPromise = (async() => {
			this.reset();

			const playback = await getAudioPlayback(audioTrack);
			if(!playback) {
				throw new Error(`Unsupported audio codec for MSE: ${await audioTrack.getCodecParameterString() || await audioTrack.getCodec()}`);
			}
			const rawMp3 = playback.mode === 'mp3';
			let transcodeTarget = null;
			if(playback.mode === 'transcode') {
				await loadAc3Decoder();
				transcodeTarget = await pickTranscodeTarget();
				if(!transcodeTarget) throw new Error('This browser cannot re-encode Dolby audio to a codec it can play.');
			}
			const mime = transcodeTarget?.mime || playback.mime;

			const packetSource = rawMp3 || transcodeTarget ? null : new MB.EncodedAudioPacketSource(await audioTrack.getCodec());
			const sampleSource = transcodeTarget ? new MB.AudioSampleSource({
				codec: transcodeTarget.codec,
				quality: MB.QUALITY_MEDIUM,
				transform: {numberOfChannels: 2, sampleRate: 48000},
			}) : null;
			const format = rawMp3 ? null : new MB.Mp4OutputFormat({
				fastStart: 'fragmented',
				minimumFragmentDuration: 0.35,
				onFtyp: (data) => this.#enqueueChunk(data, sessionToken, isSessionCurrent),
				onMoov: (data) => this.#enqueueChunk(data, sessionToken, isSessionCurrent),
				onMoof: (data) => this.#enqueueChunk(data, sessionToken, isSessionCurrent),
				onMdat: (data) => this.#enqueueChunk(data, sessionToken, isSessionCurrent),
			});

			const output = rawMp3 ? null : new MB.Output({
				format,
				target: new MB.NullTarget(),
			});

			if(output) {
				output.addAudioTrack(sampleSource || packetSource);
				await output.start();
			}
			if(!isSessionCurrent(sessionToken)) {
				await output?.cancel();
				return;
			}

			await this.#setupMediaSource(mime, sessionToken, isSessionCurrent, {sequence: rawMp3});
			if(!isSessionCurrent(sessionToken)) {
				await output?.cancel();
				return;
			}

			const firstPacket = sourceMode === SOURCE_MODE.JELLYFIN
				? await packetSink.getFirstPacket()
				: (startAtSec > 0 ? await packetSink.getPacket(startAtSec) : await packetSink.getFirstPacket());

			if(!firstPacket) {
				await output?.cancel();
				throw new Error('Audio stream has no packets.');
			}

			const timestampBase = sourceMode === SOURCE_MODE.JELLYFIN
				? firstPacket.timestamp
				: startAtSec;
			this.#timelineOriginSec = Number(timestampBase);

			// Waits while enough audio is buffered ahead; false once the session was replaced.
			const waitForRoom = async() => {
				while(isSessionCurrent(sessionToken)) {
					const bufferedAheadSec = this.getBufferedAheadSeconds();
					if(bufferedAheadSec < 24 && this.#appendQueueBytes < 6 * 1024 * 1024) break;
					await this.#delay(80);
				}
				return isSessionCurrent(sessionToken);
			};

			if(transcodeTarget) {
				// Last resort for Dolby-only streams: decode in WASM, downmix to stereo and re-encode. CPU heavy.
				const sampleSink = new MB.AudioSampleSink(audioTrack);
				for await (const sample of sampleSink.samples(firstPacket.timestamp)) {
					if(!await waitForRoom()) {
						sample.close();
						await output?.cancel();
						return;
					}
					const shiftedTs = sample.timestamp - timestampBase;
					if(sourceMode !== SOURCE_MODE.JELLYFIN && shiftedTs + sample.duration < 0) {
						sample.close();
						continue;
					}
					sample.setTimestamp(Math.max(0, shiftedTs));
					await sampleSource.add(sample);
					sample.close();
				}
			} else {
				const decoderConfig = await audioTrack.getDecoderConfig();
				let sentMeta = false;
				let rawBatch = [];
				let rawBatchSec = 0;
				const flushRawBatch = () => {
					if(!rawBatch.length) return;
					this.#enqueueChunk(concatBytes(rawBatch), sessionToken, isSessionCurrent);
					rawBatch = [];
					rawBatchSec = 0;
				};

				for await (const packet of packetSink.packets(firstPacket)) {
					if(!await waitForRoom()) {
						await output?.cancel();
						return;
					}

					const shiftedTs = packet.timestamp - timestampBase;
					if(sourceMode !== SOURCE_MODE.JELLYFIN && shiftedTs + packet.duration < 0) continue;

					const normalizedTs = Math.max(0, shiftedTs);
					if(rawMp3) {
						// In 'sequence' mode the browser places appended frames one after another from this offset.
						if(!sentMeta && this.#sourceBuffer) this.#sourceBuffer.timestampOffset = normalizedTs;
						sentMeta = true;
						rawBatch.push(packet.data);
						rawBatchSec += packet.duration;
						if(rawBatchSec >= 0.35) flushRawBatch();
						continue;
					}
					const shiftedPacket = packet.clone({timestamp: normalizedTs});
					const meta = !sentMeta && decoderConfig ? {decoderConfig} : undefined;

					await packetSource.add(shiftedPacket, meta);
					sentMeta = true;
				}
				flushRawBatch();
			}

			packetSource?.close();
			sampleSource?.close();
			await output?.finalize();
			await this.#appendChain;

			if(isSessionCurrent(sessionToken) && this.#mediaSource && this.#mediaSource.readyState === 'open') {
				try {
					this.#mediaSource.endOfStream();
				} catch {
					// no-op
				}
			}
		})().catch((error) => {
			if(!isSessionCurrent(sessionToken)) return;
			this.#onError(`Audio pipeline error: ${error?.message || error}`);
		}).finally(() => {
			if(isSessionCurrent(sessionToken)) {
				this.#transmuxPromise = null;
			}
		});
	}

	async #setupMediaSource(mime, sessionToken, isSessionCurrent, {sequence = false} = {}) {
		const mediaSource = new MediaSource();

		this.#revokeAudioObjectUrl();
		this.#audioObjectUrl = URL.createObjectURL(mediaSource);
		this.#audio.src = this.#audioObjectUrl;

		await this.#openMediaSourceOnce(mediaSource);

		if(!isSessionCurrent(sessionToken)) return;

		let sourceBuffer;
		try {
			sourceBuffer = mediaSource.addSourceBuffer(mime);
		} catch(error) {
			throw new Error(`Cannot create SourceBuffer for ${mime}: ${error?.message || error}`);
		}

		// Raw MP3 carries no timestamps, so the browser requires 'sequence' mode for it.
		sourceBuffer.mode = sequence ? 'sequence' : 'segments';

		this.#mediaSource = mediaSource;
		this.#sourceBuffer = sourceBuffer;
		this.#audio.playbackRate = this.#currentSpeed;

		this.#flushQueue(sessionToken, isSessionCurrent);
	}

	#enqueueChunk(data, sessionToken, isSessionCurrent) {
		if(!isSessionCurrent(sessionToken)) return;

		const chunk = toBytes(data);
		this.#appendQueue.push(chunk);
		this.#appendQueueBytes += chunk.byteLength;
		this.#flushQueue(sessionToken, isSessionCurrent);
	}

	#flushQueue(sessionToken, isSessionCurrent) {
		if(this.#flushRunning) return;
		this.#flushRunning = true;

		(async() => {
			while(isSessionCurrent(sessionToken) && this.#appendQueue.length) {
				const chunk = this.#appendQueue.shift();
				if(!chunk) continue;
				this.#appendQueueBytes = Math.max(0, this.#appendQueueBytes - chunk.byteLength);

				this.#appendChain = this.#appendChain
					.catch(() => {
						// no-op for stale chain errors
					})
					.then(async() => {
						await this.#appendChunk(chunk, sessionToken, isSessionCurrent);
						if(!this.#firstAppendDone) {
							this.#firstAppendDone = true;
							this.#resolveFirstAppend?.(true);
							this.#resolveFirstAppend = null;
						}
					});

				try {
					await this.#appendChain;
				} catch(error) {
					if(isSessionCurrent(sessionToken)) {
						this.#onError(`Append queue error: ${error?.message || error}`);
					}
					return;
				}
			}
		})().catch((error) => {
			if(isSessionCurrent(sessionToken)) {
				this.#onError(`Append loop failure: ${error?.message || error}`);
			}
		}).finally(() => {
			this.#flushRunning = false;
			if(isSessionCurrent(sessionToken) && this.#appendQueue.length) {
				this.#flushQueue(sessionToken, isSessionCurrent);
			}
		});
	}

	async #appendChunk(chunk, sessionToken, isSessionCurrent) {
		if(!isSessionCurrent(sessionToken)) return;

		const sb = this.#sourceBuffer;
		const ms = this.#mediaSource;

		if(!sb || !ms || ms.readyState !== 'open') {
			await this.#delay(10);
			return;
		}

		await this.#waitSourceBufferIdle(sb);

		if(!isSessionCurrent(sessionToken) || ms.readyState !== 'open') return;

		await this.#appendBufferOnce(sb, chunk);
	}

	#revokeAudioObjectUrl() {
		if(!this.#audioObjectUrl) return;
		URL.revokeObjectURL(this.#audioObjectUrl);
		this.#audioObjectUrl = null;
	}

	#waitForEventOnce(target, successEvent, errorEvents = []) {
		return new Promise((resolve, reject) => {
			const errorList = Array.isArray(errorEvents) ? errorEvents : [errorEvents];

			const cleanup = () => {
				target.removeEventListener(successEvent, onSuccess);
				errorList.forEach((eventName) => {
					if(!eventName) return;
					target.removeEventListener(eventName, onError);
				});
			};

			const onSuccess = () => {
				cleanup();
				resolve();
			};

			const onError = () => {
				cleanup();
				reject(new Error(`${successEvent} wait failed.`));
			};

			target.addEventListener(successEvent, onSuccess, {once: true});
			errorList.forEach((eventName) => {
				if(!eventName) return;
				target.addEventListener(eventName, onError, {once: true});
			});
		});
	}

	async #waitSourceBufferIdle(sourceBuffer) {
		if(!sourceBuffer?.updating) return;
		await this.#waitForEventOnce(sourceBuffer, 'updateend');
	}

	async #appendBufferOnce(sourceBuffer, chunk) {
		const done = this.#waitForEventOnce(sourceBuffer, 'updateend', ['error']);
		try {
			sourceBuffer.appendBuffer(chunk);
		} catch(error) {
			throw new Error(`SourceBuffer append failed: ${error?.message || error}`);
		}
		await done;
	}

	async #openMediaSourceOnce(mediaSource) {
		await this.#waitForEventOnce(mediaSource, 'sourceopen', ['sourceclose']);
	}

	#delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

export class VideoCanvasPipeline {
	#canvas;
	#ctx;
	#onWarning;

	#canvasSink;
	#videoIterator;
	#nextFrame;
	#videoPullPromise;
	#videoTimestampOffsetSec;

	constructor(canvasElement, onWarning) {
		this.#canvas = canvasElement;
		this.#ctx = this.#canvas.getContext('2d');
		this.#onWarning = onWarning;

		this.#canvasSink = null;
		this.#videoIterator = null;
		this.#nextFrame = null;
		this.#videoPullPromise = null;
		this.#videoTimestampOffsetSec = 0;
	}

	async configure(videoTrack) {
		this.#canvasSink = new MB.CanvasSink(videoTrack, {fit: 'contain', poolSize: 2});
		const displayWidth = await videoTrack.getDisplayWidth();
		const displayHeight = await videoTrack.getDisplayHeight();
		// Avoid clearing the canvas on every seek/rebuffer when dimensions are unchanged.
		if(this.#canvas.width !== displayWidth) {
			this.#canvas.width = displayWidth;
		}
		if(this.#canvas.height !== displayHeight) {
			this.#canvas.height = displayHeight;
		}
	}

	setTimestampOffset(offsetSec) {
		const safe = Number(offsetSec);
		if(!Number.isFinite(safe)) return;
		this.#videoTimestampOffsetSec = safe;
	}

	async primeAt(absoluteSec, options = {timeoutMs: 0, maxLeadSec: 0.18}) {
		if(!this.#videoIterator) return false;

		const target = Math.max(0, Number(absoluteSec) || 0);
		const timeoutMs = Math.max(0, Number(options?.timeoutMs) || 0);
		const maxLeadSec = Number.isFinite(options?.maxLeadSec)
			? Math.max(0, Number(options.maxLeadSec))
			: 0.18;
		const deadline = timeoutMs > 0 ? performance.now() + timeoutMs : 0;

		while(true) {
			this.#ensureNextFrame();
			if(this.#videoPullPromise) {
				await Promise.race([
					this.#videoPullPromise,
					this.#delay(24),
				]);
			}

			if(this.#nextFrame) {
				const frameTime = this.#nextFrame.timestamp + this.#videoTimestampOffsetSec;
				if(frameTime <= target + maxLeadSec) {
					this.#drawFrame(this.#nextFrame);
					this.#nextFrame = null;
					this.#ensureNextFrame();
					return true;
				}
			}

			if(timeoutMs <= 0 || performance.now() >= deadline) break;
			await this.#delay(16);
		}

		return false;
	}

	async startAt(startAtSec, sourceMode, sessionToken, isSessionCurrent) {
		if(!this.#canvasSink) throw new Error('CanvasSink not initialized.');

		await this.stop();
		if(!isSessionCurrent(sessionToken)) return;

		const iteratorStart = sourceMode === SOURCE_MODE.JELLYFIN ? undefined : startAtSec;
		this.#videoIterator = this.#canvasSink.canvases(iteratorStart);
		this.#nextFrame = null;
		this.#videoPullPromise = null;
		this.#videoTimestampOffsetSec = 0;

		const first = await this.#videoIterator.next();
		if(!isSessionCurrent(sessionToken)) return;

		if(first?.value) {
			this.#nextFrame = first.value;
		}
	}

	async stop() {
		if(this.#videoIterator && typeof this.#videoIterator.return === 'function') {
			try {
				await this.#videoIterator.return();
			} catch {
				// no-op
			}
		}

		this.#videoIterator = null;
		this.#nextFrame = null;
		this.#videoPullPromise = null;
		this.#videoTimestampOffsetSec = 0;
	}

	tick(absoluteSec) {
		if(!this.#videoIterator) return;

		this.#ensureNextFrame();

		let guard = 0;
		while(this.#nextFrame && (this.#nextFrame.timestamp + this.#videoTimestampOffsetSec) <= absoluteSec + 0.008 && guard < 4) {
			this.#drawFrame(this.#nextFrame);
			this.#nextFrame = null;
			this.#ensureNextFrame();
			guard += 1;
		}
	}

	#drawFrame(frame) {
		if(!frame?.canvas) return;
		this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
		this.#ctx.drawImage(frame.canvas, 0, 0, this.#canvas.width, this.#canvas.height);
	}

	#ensureNextFrame() {
		if(!this.#videoIterator || this.#nextFrame || this.#videoPullPromise) return;

		this.#videoPullPromise = this.#videoIterator.next()
			.then((res) => {
				this.#nextFrame = res?.value || null;
			})
			.catch((error) => {
				this.#onWarning(`Video iterator warning: ${error?.message || error}`);
			})
			.finally(() => {
				this.#videoPullPromise = null;
			});
	}

	#delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
