/**
 * <carplayer-clearable-input> – input with integrated ✕ clear button.
 *
 * Usage:
 *   <carplayer-clearable-input id="apiKeyInput" type="text"
 *     placeholder="Paste your Jellyfin API key" class="field field--api">
 *   </carplayer-clearable-input>
 *
 * Attributes: value, placeholder, type, readonly, name, autocomplete
 * Properties: .value (get/set)
 * Events: 'input', 'change', 'keydown' (all bubble from inner <input>)
 */
export default class CarplayerClearableInput extends HTMLElement {
    #rendered = false;

    static get observedAttributes() {
        return ['value', 'placeholder', 'type', 'readonly', 'name', 'autocomplete'];
    }

    constructor() {
        super();
    }

    connectedCallback() {
        if (!this.#rendered) {
            this.#render();
            this.#rendered = true;
        }
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (oldVal === newVal || !this.dom?.input) return;

        if (name === 'value') {
            this.dom.input.value = newVal ?? '';
            this.#toggleClear();
        } else if (name === 'readonly') {
            if (newVal !== null) this.dom.input.setAttribute('readonly', '');
            else this.dom.input.removeAttribute('readonly');
        } else {
            this.dom.input.setAttribute(name, newVal ?? '');
        }
    }

    // ── Public API ───────────────────────────────────────

    get value() {
        return this.dom?.input ? this.dom.input.value : (this.getAttribute('value') || '');
    }

    set value(v) {
        if (this.dom?.input) {
            this.dom.input.value = v ?? '';
            this.#toggleClear();
        }
        this.setAttribute('value', v ?? '');
    }

    focus() {
        this.dom?.input?.focus();
    }

    get inputElement() {
        return this.dom?.input;
    }

    // ── Private ──────────────────────────────────────────

    #render() {
        this.innerHTML = `
            <input id="input" class="field__input field__input--with-clear">
            <button id="clearBtn" class="field-clear field-clear--absolute" type="button" title="Clear">✕</button>
        `;

        // Smart DOM Caching
        this.dom = Object.fromEntries([...this.querySelectorAll('[id]')].map(el => [el.id, el]));

        // Forward attributes
        const type = this.getAttribute('type') || 'text';
        this.dom.input.type = type;
        const placeholder = this.getAttribute('placeholder');
        if (placeholder) this.dom.input.placeholder = placeholder;
        const name = this.getAttribute('name');
        if (name) this.dom.input.name = name;
        const autocomplete = this.getAttribute('autocomplete');
        if (autocomplete) this.dom.input.autocomplete = autocomplete;
        if (this.hasAttribute('readonly')) this.dom.input.readOnly = true;
        const val = this.getAttribute('value');
        if (val) this.dom.input.value = val;

        // Transfer id from host to inner input for label[for] compat
        const hostId = this.getAttribute('id');
        if (hostId) {
            this.dom.input.id = hostId + 'Input';
        }

        this.#toggleClear();

        // Events
        this.dom.input.addEventListener('input', () => {
            this.#toggleClear();
            // Re-dispatch so external listeners on the component hear it
            this.dispatchEvent(new Event('input', { bubbles: true }));
        });

        this.dom.clearBtn.addEventListener('click', () => {
            this.dom.input.value = '';
            this.#toggleClear();
            this.dom.input.focus();
            this.dispatchEvent(new Event('input', { bubbles: true }));
            this.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    #toggleClear() {
        if (!this.dom?.clearBtn || !this.dom?.input) return;
        const hasValue = this.dom.input.value.trim().length > 0;
        this.dom.clearBtn.classList.toggle('is-visible', hasValue);
    }
}

customElements.define('carplayer-clearable-input', CarplayerClearableInput);
