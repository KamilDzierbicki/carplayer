/**
 * <carplayer-modal> – modal dialog wrapper.
 *
 * Usage:
 *   <carplayer-modal id="settingsModal" modal-title="Settings" variant="settings">
 *     <!-- body content here (slotted) -->
 *   </carplayer-modal>
 *
 * Attributes: modal-title, variant (maps to modal__content--{variant})
 * Methods: .open(), .close(), .toggle()
 * Events: 'modal-close' (bubbles)
 */
export default class CarplayerModal extends HTMLElement {

    static get observedAttributes() {
        return ['modal-title', 'variant'];
    }

    constructor() {
        super();
        this._content = null;
        this._closeBtn = null;
        this._titleEl = null;
        this._body = null;
        this._rendered = false;
    }

    connectedCallback() {
        if (!this._rendered) {
            this._render();
            this._rendered = true;
        }
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (oldVal === newVal) return;
        if (name === 'modal-title' && this._titleEl) {
            this._titleEl.textContent = newVal ?? '';
        }
        if (name === 'variant' && this._content) {
            // Remove old variant class
            if (oldVal) this._content.classList.remove(`modal__content--${oldVal}`);
            if (newVal) this._content.classList.add(`modal__content--${newVal}`);
        }
    }

    // ── Public API ───────────────────────────────────────

    open() {
        this.classList.add('active');
    }

    close() {
        this.classList.remove('active');
        this.dispatchEvent(new CustomEvent('modal-close', { bubbles: true }));
    }

    toggle() {
        if (this.classList.contains('active')) this.close();
        else this.open();
    }

    // ── Private ──────────────────────────────────────────

    _render() {
        this.classList.add('modal');

        // Collect existing children before we restructure
        const existingChildren = Array.from(this.childNodes);

        // Build wrapper
        this._content = document.createElement('div');
        this._content.className = 'modal__content';
        const variant = this.getAttribute('variant');
        if (variant) this._content.classList.add(`modal__content--${variant}`);

        // Close button
        this._closeBtn = document.createElement('button');
        this._closeBtn.className = 'modal__close';
        this._closeBtn.setAttribute('type', 'button');
        this._closeBtn.setAttribute('aria-label', 'Close modal');
        this._closeBtn.innerHTML = '<span class="icon icon--md icon-mask icon-mask--close" aria-hidden="true"></span>';

        // Title
        const title = this.getAttribute('modal-title') || '';
        this._titleEl = document.createElement('h2');
        this._titleEl.className = 'modal__title';
        this._titleEl.textContent = title;

        // Body — wrap original children
        this._body = document.createDocumentFragment();
        existingChildren.forEach(child => this._body.appendChild(child));

        // Assemble
        this._content.appendChild(this._closeBtn);
        this._content.appendChild(this._titleEl);
        this._content.appendChild(this._body);
        this.appendChild(this._content);

        // Events
        this._closeBtn.addEventListener('click', () => this.close());
        this.addEventListener('click', (e) => {
            // Click on the modal backdrop (self) closes
            if (e.target === this) this.close();
        });
    }
}

customElements.define('carplayer-modal', CarplayerModal);
