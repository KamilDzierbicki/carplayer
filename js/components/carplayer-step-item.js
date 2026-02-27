export default class CarplayerStepItem extends HTMLElement {
    static get observedAttributes() {
        return ['number'];
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._rendered = false;
        this._badge = null;
    }

    connectedCallback() {
        if (!this._rendered) {
            this._render();
            this._rendered = true;
        }
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (name === 'number' && this._badge) {
            this._badge.textContent = newVal || '';
        }
    }

    _render() {
        const number = this.getAttribute('number') || '';

        this.shadowRoot.innerHTML = `
            <style>
              :host {
                display: flex;
                align-items: var(--cp-step-align, flex-start);
                gap: var(--cp-step-gap, var(--space-4));
              }

              .badge {
                flex-shrink: 0;
                inline-size: var(--cp-step-badge-size, 1.75rem);
                block-size: var(--cp-step-badge-size, 1.75rem);
                border-radius: 50%;
                display: grid;
                place-items: center;
                background: var(--cp-step-badge-bg, var(--color-track));
                color: var(--cp-step-badge-color, var(--color-ink));
                font-size: var(--cp-step-badge-font-size, 0.85rem);
                font-weight: 700;
              }

              .desc {
                flex: 1;
                max-inline-size: var(--cp-step-desc-max-inline-size, none);
                color: var(--cp-step-desc-color, var(--color-muted));
                font-size: var(--cp-step-desc-size, 0.84rem);
                line-height: var(--cp-step-desc-line-height, 1.5);
              }

              ::slotted(*) {
                margin: 0;
              }

              ::slotted(p) {
                margin: 0;
                color: inherit;
                font-size: inherit;
                line-height: inherit;
              }
            </style>
            <div class="badge" id="badge"></div>
            <div class="desc">
              <slot></slot>
            </div>
        `;

        this._badge = this.shadowRoot.getElementById('badge');
        this._badge.textContent = number;
    }
}

customElements.define('carplayer-step-item', CarplayerStepItem);
