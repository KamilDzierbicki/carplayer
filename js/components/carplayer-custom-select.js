/**
 * <carplayer-custom-select> – a drop-in replacement for the repeated
 * .custom-select blocks in index.html.
 *
 * Usage:
 *   <carplayer-custom-select id="speedSelect" title="Playback Speed" value="1">
 *     <option value="0.5">0.5x</option>
 *     <option value="1" selected>1.0x</option>
 *   </carplayer-custom-select>
 *
 * Programmatic API:
 *   el.value            – get/set selected value
 *   el.setOptions(arr)  – replace options from [{value, label, selected?}]
 *   el.appendOption(opt) – add a single option {value, label}
 *   el.show() / el.hide()
 *
 * Events:
 *   'change' – detail: { value }
 */
export default class CarplayerCustomSelect extends HTMLElement {
    #s = {
        isOpen: false,
        options: [],     // [{value, label, selected}]
        value: ''
    };

    #boundClose = this.#onOutsideClick.bind(this);
    #rendered = false;

    static get observedAttributes() {
        return ['value', 'title'];
    }

    constructor() {
        super();
    }

    connectedCallback() {
        if (!this.#rendered) {
            this.#parseSlottedOptions();

            const attrVal = this.getAttribute('value');
            if (attrVal !== null) {
                this.#s.value = attrVal;
            }

            this.#renderInitial();
            this.#rendered = true;
        }
        window.addEventListener('click', this.#boundClose);
    }

    disconnectedCallback() {
        window.removeEventListener('click', this.#boundClose);
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (oldVal === newVal) return;
        if (name === 'value') {
            this.update({ value: newVal ?? '' });
        }
        if (name === 'title' && this.dom?.trigger) {
            this.dom.trigger.setAttribute('title', newVal ?? '');
        }
    }

    // ── Public API ───────────────────────────────────────

    get value() {
        return this.#s.value;
    }

    set value(v) {
        const str = String(v ?? '');
        if (str === this.#s.value) return;
        this.setAttribute('value', str);
    }

    setOptions(arr) {
        const options = (arr || []).map(o => ({
            value: String(o.value ?? ''),
            label: String(o.label ?? o.value ?? ''),
            selected: Boolean(o.selected),
        }));

        const sel = options.find(o => o.selected);
        let value = this.#s.value;
        if (sel) value = sel.value;

        this.update({ options, value });
    }

    appendOption(opt) {
        const options = [...this.#s.options, {
            value: String(opt.value ?? ''),
            label: String(opt.label ?? opt.value ?? ''),
            selected: false,
        }];
        this.update({ options });
    }

    show() { this.classList.remove('hidden'); }
    hide() { this.classList.add('hidden'); }

    blur() {
        this.#close();
        super.blur();
    }

    // ── Internal / Render ────────────────────────────────

    #parseSlottedOptions() {
        const opts = this.querySelectorAll('option');
        const options = [];
        let value = this.#s.value;

        opts.forEach(opt => {
            const entry = {
                value: opt.value ?? opt.textContent.trim(),
                label: opt.textContent.trim(),
                selected: opt.hasAttribute('selected'),
            };
            options.push(entry);
            if (entry.selected && !value) {
                value = entry.value;
            }
        });

        opts.forEach(o => o.remove());
        this.#s.options = options;
        this.#s.value = value;
    }

    #renderInitial() {
        this.classList.add('custom-select');
        this.setAttribute('tabindex', '0');

        const title = this.getAttribute('title') || '';

        this.innerHTML = `
            <div id="trigger" class="custom-select__trigger" ${title ? `title="${title}"` : ''}>
                <span id="valueEl" class="custom-select__value"></span>
                <span class="icon icon--sm icon-mask icon-mask--chevron-down" aria-hidden="true"></span>
            </div>
            <div id="optionsEl" class="custom-select__options"></div>
        `;

        this.dom = Object.fromEntries([...this.querySelectorAll('[id]')].map(el => [el.id, el]));

        this.dom.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.#s.isOpen) { this.#close(); } else { this.#open(); }
        });

        this.dom.optionsEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const opt = e.target.closest('.custom-select__option');
            if (!opt) return;
            this.#select(opt.dataset.value);
        });

        this.#renderOptions();
        this.#syncSelection();
    }

    update(newState) {
        const oldState = { ...this.#s };
        this.#s = { ...this.#s, ...newState };

        if (!this.dom) return;

        if (oldState.options !== this.#s.options) {
            this.#renderOptions();
        }

        if (oldState.value !== this.#s.value || oldState.options !== this.#s.options) {
            this.#syncSelection();
        }
    }

    #renderOptions() {
        if (!this.dom?.optionsEl) return;

        this.dom.optionsEl.innerHTML = this.#s.options.map(opt => `
            <div class="custom-select__option ${opt.value === this.#s.value ? 'is-selected' : ''}" data-value="${opt.value}">
                ${opt.label}
            </div>
        `).join('');
    }

    #syncSelection() {
        if (!this.dom?.optionsEl || !this.dom?.valueEl) return;

        const children = Array.from(this.dom.optionsEl.children);
        let matchedLabel = '';

        children.forEach(child => {
            const isMatch = child.dataset.value === this.#s.value;
            child.classList.toggle('is-selected', isMatch);
            if (isMatch) matchedLabel = child.textContent.trim();
        });

        if (matchedLabel) {
            this.dom.valueEl.textContent = matchedLabel;
        }

        this.#s.options = this.#s.options.map(o => ({ ...o, selected: o.value === this.#s.value }));
    }

    #select(val) {
        const old = this.#s.value;
        this.update({ value: val });
        this.#close();

        // Update attribute without triggering loop (attributeChangedCallback checks old===new)
        this.setAttribute('value', val);

        if (val !== old) {
            this.dispatchEvent(new CustomEvent('change', {
                bubbles: true,
                detail: { value: val },
            }));
        }
    }

    #open() {
        document.querySelectorAll('carplayer-custom-select.is-open').forEach(s => {
            if (s !== this && s instanceof CarplayerCustomSelect) {
                s.#close();
            }
        });

        this.#s.isOpen = true;
        this.classList.add('is-open');
    }

    #close() {
        this.#s.isOpen = false;
        this.classList.remove('is-open');
    }

    #onOutsideClick(e) {
        if (this.#s.isOpen && !this.contains(e.target)) {
            this.#close();
        }
    }
}

customElements.define('carplayer-custom-select', CarplayerCustomSelect);
