
export default class CarplayerProgressBar extends HTMLElement {
    #duration = 0;
    #currentTime = 0;
    #bufferedFrom = 0;
    #bufferedUntil = 0;
    #dragging = false;

    constructor() {
        super();
        this.innerHTML = `
            <div class="progress" id="progressWrapper">
                <div class="progress-bar-bg" id="progressBg">
                    <div class="progress-buffer-layer" id="progressBufferLayer" aria-hidden="true"></div>
                    <div class="progress-bar-fill" id="progressFill"></div>
                </div>
            </div>
        `;

        this.wrapper = this.querySelector('#progressWrapper');
        this.bg = this.querySelector('#progressBg');
        this.bufferLayer = this.querySelector('#progressBufferLayer');
        this.fill = this.querySelector('#progressFill');

        this.#bindEvents();
    }

    get isDragging() {
        return this.#dragging;
    }

    set duration(val) {
        this.#duration = Number(val) || 0;
        this.#renderBuffered();
        this.#renderProgress();
    }

    get duration() {
        return this.#duration;
    }

    set currentTime(val) {
        if (this.#dragging) return;
        this.#currentTime = Math.max(0, Math.min(Number(val) || 0, this.#duration));
        this.#renderProgress();
    }

    get currentTime() {
        return this.#currentTime;
    }

    setBuffered(from, until) {
        this.#bufferedFrom = Math.max(0, Number(from) || 0);
        this.#bufferedUntil = Math.max(0, Number(until) || 0);
        this.#renderBuffered();
    }

    #renderProgress() {
        if (!this.#duration) {
            this.fill.style.width = '0%';
            return;
        }
        this.fill.style.width = `${(this.#currentTime / this.#duration) * 100}%`;
    }

    #renderBuffered() {
        this.bufferLayer.innerHTML = '';
        if (!this.#duration || this.#bufferedUntil <= this.#bufferedFrom) return;

        const f = Math.max(0, Math.min(this.#bufferedFrom, this.#duration));
        const u = Math.max(f, Math.min(this.#bufferedUntil, this.#duration));

        const seg = document.createElement("div");
        seg.className = "progress-buffer-segment";
        seg.style.left = `${(f / this.#duration) * 100}%`;
        seg.style.width = `${((u - f) / this.#duration) * 100}%`;

        this.bufferLayer.appendChild(seg);
    }

    #bindEvents() {
        this.wrapper.addEventListener('pointerdown', (e) => this.#startDrag(e));
    }

    #startDrag(event) {
        if (!this.#duration) return;
        this.#dragging = true;
        this.wrapper.setPointerCapture(event.pointerId);

        const preview = (cx) => {
            const rect = this.bg.getBoundingClientRect();
            const r = Math.max(0, Math.min((cx - rect.left) / rect.width, 1));
            this.#currentTime = r * this.#duration;
            this.#renderProgress();
            this.dispatchEvent(new CustomEvent('seek-preview', { detail: this.#currentTime }));
            return r;
        };

        preview(event.clientX);

        const onMove = (e) => {
            if (this.#dragging) preview(e.clientX);
        };

        const onUp = (e) => {
            this.#dragging = false;
            this.wrapper.releasePointerCapture(event.pointerId);
            const ratio = preview(e.clientX);
            const targetTime = ratio * this.#duration;

            this.dispatchEvent(new CustomEvent('seek', { detail: targetTime }));

            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }
}

customElements.define('carplayer-progress-bar', CarplayerProgressBar);
