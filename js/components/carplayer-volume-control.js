export default class CarplayerVolumeControl extends HTMLElement {
    #volume = 1;
    #muted = false;

    constructor() {
        super();
        this.innerHTML = `
            <div class="volume-control">
                <button class="icon-btn icon-btn--control icon-btn--small" id="muteBtn" type="button">
                    <span class="icon icon--md icon-mask icon-mask--volume" aria-hidden="true"></span>
                </button>
                <input type="range" class="volume-slider" id="volumeSlider" min="0" max="1" step="0.01" value="1" />
            </div>
        `;

        this.muteBtn = this.querySelector('#muteBtn');
        this.volumeSlider = this.querySelector('#volumeSlider');
        this.iconSpan = this.muteBtn.querySelector('.icon');

        this.#bindEvents();
    }

    set volume(val) {
        this.#volume = Math.max(0, Math.min(Number(val) || 0, 1));
        this.#render();
    }

    get volume() {
        return this.#volume;
    }

    set muted(val) {
        this.#muted = Boolean(val);
        this.#render();
    }

    get muted() {
        return this.#muted;
    }

    get effectiveVolume() {
        return this.#muted ? 0 : this.#volume;
    }

    #render() {
        const vol = this.effectiveVolume;
        this.volumeSlider.value = String(vol);

        const isMuted = vol === 0;
        this.iconSpan.className = isMuted
            ? 'icon icon--md icon-mask icon-mask--volume-mute'
            : 'icon icon--md icon-mask icon-mask--volume';
    }

    #bindEvents() {
        this.muteBtn.addEventListener('click', () => {
            this.#muted = !this.#muted;
            this.#render();
            this.#notify();
        });

        this.volumeSlider.addEventListener('input', (e) => {
            this.#muted = false;
            this.#volume = Number(e.target.value) || 0;
            this.#render();
            this.#notify();
        });
    }

    #notify() {
        this.dispatchEvent(new CustomEvent('volumechange', {
            detail: { volume: this.#volume, muted: this.#muted, effectiveVolume: this.effectiveVolume }
        }));
    }
}

customElements.define('carplayer-volume-control', CarplayerVolumeControl);
