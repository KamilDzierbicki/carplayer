export default class CarplayerMediaView extends HTMLElement {
    constructor() {
        super();
        this._rendered = false;

        this.loader = null;
        this.canvas = null;
        this.captionOverlay = null;
        this.skipIndicator = null;
    }

    connectedCallback() {
        if (!this._rendered) {
            this._render();
            this._rendered = true;
        }
    }

    _render() {
        this.innerHTML = `
            <div class="loader" id="loader"></div>
            <div id="mediaContainer">
              <canvas id="videoCanvas"></canvas>
              <div id="captionOverlay" class="caption-overlay" aria-live="off"></div>
              <div id="skipIndicator" class="skip-indicator"></div>
            </div>
        `;

        this.loader = this.querySelector('#loader');
        this.canvas = this.querySelector('#videoCanvas');
        this.captionOverlay = this.querySelector('#captionOverlay');
        this.skipIndicator = this.querySelector('#skipIndicator');
    }
}

customElements.define('carplayer-media-view', CarplayerMediaView);
