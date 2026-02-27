export default class CarplayerVideoControls extends HTMLElement {
    #playing = false;

    constructor() {
        super();
        this.innerHTML = `
            <div class="player-controls" id="controls">
                <button class="icon-btn icon-btn--control" id="skipBackBtn" type="button" title="Back 10s">
                    <svg viewBox="0 0 24 24" class="icon icon--md" style="fill: currentColor; width: 1.5rem; height: 1.5rem;">
                        <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                        <text x="12" y="16.5" text-anchor="middle" style="font-size:7.5px;font-weight:bold;fill:currentColor;font-family:sans-serif">10</text>
                    </svg>
                </button>

                <button class="icon-btn icon-btn--control" id="playPauseBtn" type="button">
                    <span id="iconPlay" class="icon icon--md icon-mask icon-mask--play" aria-hidden="true"></span>
                    <span id="iconPause" class="icon icon--md icon-mask icon-mask--pause hidden" aria-hidden="true"></span>
                </button>

                <button class="icon-btn icon-btn--control" id="skipFwdBtn" type="button" title="Forward 10s">
                    <svg viewBox="0 0 24 24" class="icon icon--md" style="fill: currentColor; width: 1.5rem; height: 1.5rem;">
                        <path d="M12.01 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
                        <text x="12" y="16.5" text-anchor="middle" style="font-size:7.5px;font-weight:bold;fill:currentColor;font-family:sans-serif">10</text>
                    </svg>
                </button>

                <div class="player-time">
                    <span id="currentTimeDisplay">00:00</span> /
                    <output id="durationDisplay">00:00</output>
                </div>

                <carplayer-progress-bar id="progressBarWrapper" style="display: flex; flex: 1; align-items: center;"></carplayer-progress-bar>

                <div class="player-stream-controls">
                    <carplayer-custom-select id="qualitySelect" title="Video Quality" value="720" class="hidden">
                        <option value="360">360p - 1 Mbps</option>
                        <option value="480">480p - 2.5 Mbps</option>
                        <option value="720" selected>720p - 5 Mbps</option>
                        <option value="1080">1080p - 8 Mbps</option>
                        <option value="direct">Direct</option>
                    </carplayer-custom-select>

                    <carplayer-custom-select id="audioTrackSelect" title="Audio Track" value="" class="hidden">
                        <!-- Options injected by JS -->
                    </carplayer-custom-select>

                    <carplayer-custom-select id="captionSelect" title="Captions" value="off">
                        <option value="off" selected>Captions Off</option>
                    </carplayer-custom-select>

                    <carplayer-custom-select id="speedSelect" title="Playback Speed" value="1">
                        <option value="0.5">0.5x</option>
                        <option value="0.6">0.6x</option>
                        <option value="0.7">0.7x</option>
                        <option value="0.8">0.8x</option>
                        <option value="0.9">0.9x</option>
                        <option value="1" selected>1.0x</option>
                        <option value="1.1">1.1x</option>
                        <option value="1.2">1.2x</option>
                        <option value="1.25">1.25x</option>
                        <option value="1.3">1.3x</option>
                        <option value="1.4">1.4x</option>
                        <option value="1.5">1.5x</option>
                        <option value="1.6">1.6x</option>
                        <option value="1.7">1.7x</option>
                        <option value="1.75">1.75x</option>
                        <option value="1.8">1.8x</option>
                        <option value="1.9">1.9x</option>
                        <option value="2.0">2.0x</option>
                        <option value="2.1">2.1x</option>
                        <option value="2.2">2.2x</option>
                        <option value="2.3">2.3x</option>
                        <option value="2.4">2.4x</option>
                        <option value="2.5">2.5x</option>
                    </carplayer-custom-select>
                </div>

                <div class="player-tools">
                    <carplayer-volume-control id="volumeControlWrapper"></carplayer-volume-control>
                </div>
            </div>
        `;

        this.controlsEl = this.querySelector('#controls');
        this.playPauseBtn = this.querySelector('#playPauseBtn');
        this.iconPlay = this.querySelector('#iconPlay');
        this.iconPause = this.querySelector('#iconPause');
        this.skipBackBtn = this.querySelector('#skipBackBtn');
        this.skipFwdBtn = this.querySelector('#skipFwdBtn');

        this.currentTimeDisplay = this.querySelector('#currentTimeDisplay');
        this.durationDisplay = this.querySelector('#durationDisplay');

        this.progressBar = this.querySelector('carplayer-progress-bar');
        this.volumeControl = this.querySelector('carplayer-volume-control');

        this.qualitySelect = this.querySelector('#qualitySelect');
        this.audioTrackSelect = this.querySelector('#audioTrackSelect');
        this.captionSelect = this.querySelector('#captionSelect');
        this.speedSelect = this.querySelector('#speedSelect');

        this.#bindEvents();
    }

    set playing(val) {
        this.#playing = Boolean(val);
        this.#renderPlayState();
    }

    get playing() {
        return this.#playing;
    }

    #renderPlayState() {
        if (this.#playing) {
            this.playPauseBtn.classList.add('is-playing');
            this.iconPlay.classList.add('hidden');
            this.iconPause.classList.remove('hidden');
        } else {
            this.playPauseBtn.classList.remove('is-playing');
            this.iconPlay.classList.remove('hidden');
            this.iconPause.classList.add('hidden');
        }
    }

    #bindEvents() {
        this.playPauseBtn.addEventListener('click', () => {
            if (this.#playing) {
                this.dispatchEvent(new CustomEvent('action-pause'));
            } else {
                this.dispatchEvent(new CustomEvent('action-play'));
            }
        });

        this.skipBackBtn.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('action-skip', { detail: -10 }));
        });

        this.skipFwdBtn.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('action-skip', { detail: 10 }));
        });
    }

    // Methods to ease interaction from PlayerController
    setIdle(idle) {
        if (idle) {
            this.controlsEl.classList.add('idle');
        } else {
            this.controlsEl.classList.remove('idle');
        }
    }

    formatSeconds(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    setTime(currentTime, duration) {
        if (!this.progressBar.isDragging) {
            this.currentTimeDisplay.textContent = this.formatSeconds(currentTime);
            this.progressBar.currentTime = currentTime;
        }

        if (duration !== undefined && duration !== this.progressBar.duration) {
            this.durationDisplay.textContent = this.formatSeconds(duration);
            this.progressBar.duration = duration;
        }
    }
}

customElements.define('carplayer-video-controls', CarplayerVideoControls);
