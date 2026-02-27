export default class CarplayerStepList extends HTMLElement {
    static get observedAttributes() {
        return ['title'];
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._rendered = false;
        this._titleEl = null;
    }

    connectedCallback() {
        if (!this._rendered) {
            this._render();
            this._rendered = true;
        }
        this._syncTitle();
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (name === 'title' && oldVal !== newVal) {
            this._syncTitle();
        }
    }

    _render() {
        this.shadowRoot.innerHTML = `
            <style>
              :host {
                display: flex;
                flex-direction: column;
                inline-size: 100%;
                container-type: inline-size;
              }

              .title {
                margin: 0 0 var(--cp-step-list-title-margin-bottom, var(--space-1));
                color: var(--cp-step-list-title-color, currentColor);
                font-size: var(--cp-step-list-title-size, 0.95rem);
                font-weight: var(--cp-step-list-title-weight, 650);
                text-align: left;
              }

              .items {
                display: flex;
                flex-direction: column;
                gap: var(--cp-step-list-gap, var(--space-4));
              }

              ::slotted(carplayer-step-item) {
                inline-size: 100%;
              }

              @container (min-width: 26rem) {
                ::slotted(carplayer-step-item) {
                  --cp-step-align: center;
                }
              }
            </style>
            <div class="title" id="titleEl" hidden></div>
            <div class="items">
              <slot></slot>
            </div>
        `;

        this._titleEl = this.shadowRoot.getElementById('titleEl');
    }

    _syncTitle() {
        if (!this._titleEl) return;
        const title = (this.getAttribute('title') || '').trim();
        if (title) {
            this._titleEl.textContent = title;
            this._titleEl.hidden = false;
        } else {
            this._titleEl.textContent = '';
            this._titleEl.hidden = true;
        }
    }
}

customElements.define('carplayer-step-list', CarplayerStepList);
