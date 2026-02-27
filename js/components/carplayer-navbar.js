export default class CarplayerNavbar extends HTMLElement {
    constructor() {
        super();
        this.innerHTML = `
            <div class="app-nav">
                <a href="#" id="logoLink" class="app-brand" onclick="window.location.reload(); return false;">
                    <img class="icon icon--md" src="icons/favicon.svg" alt="CarPlayer Logo" />
                    CarPlayer
                </a>

                <div class="search-bar">
                    <span class="icon icon--sm icon-mask icon-mask--search search-bar__icon" aria-hidden="true"></span>
                    <form action="javascript:void(0);" class="search-bar__form">
                        <input type="text" id="searchInput" name="video_search_query" autocomplete="on" placeholder="Search on Jellyfin" class="search-bar__input" />
                    </form>
                    <button class="field-clear field-clear--inline" id="clearSearchBtn" title="Clear Search" type="button">
                        ✕
                    </button>
                </div>

                <div class="app-nav__actions">
                    <button class="btn btn--dark" id="btnOpenUrlModal">
                        <span class="icon icon--sm icon-mask icon-mask--plus" aria-hidden="true"></span>
                        Add Video
                    </button>

                    <button class="btn btn--dark" id="btnOpenLinkRelayModal">
                        <span class="icon icon--sm icon-mask icon-mask--share" aria-hidden="true"></span>
                        Send Link
                    </button>

                    <button class="btn btn--dark" id="btnFullscreenTesla" type="button">
                        <span class="icon icon--sm icon-mask icon-mask--fullscreen" aria-hidden="true"></span>
                        Fullscreen (Tesla)
                    </button>

                    <button class="icon-btn" id="btnOpenSettings" title="Settings" type="button">
                        <span class="icon icon--md icon-mask icon-mask--settings" aria-hidden="true"></span>
                    </button>
                </div>
            </div>
        `;

        this.searchInput = this.querySelector('#searchInput');
        this.clearSearchBtn = this.querySelector('#clearSearchBtn');
        this.searchForm = this.querySelector('.search-bar__form');

        this.btnOpenUrlModal = this.querySelector('#btnOpenUrlModal');
        this.btnOpenLinkRelayModal = this.querySelector('#btnOpenLinkRelayModal');
        this.btnFullscreenTesla = this.querySelector('#btnFullscreenTesla');
        this.btnOpenSettings = this.querySelector('#btnOpenSettings');

        this.#bindEvents();
    }

    #bindEvents() {
        // Search
        this.searchInput.addEventListener('input', () => {
            const hasText = this.searchInput.value.length > 0;
            this.clearSearchBtn.classList.toggle('is-visible', hasText);
        });

        this.clearSearchBtn.addEventListener('click', () => {
            this.clearSearch();
        });

        this.searchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.dispatchEvent(new CustomEvent('search', { detail: this.searchInput.value }));
        });

        const debounce = (func, limit) => {
            let inThrottle;
            return function (...args) {
                if (!inThrottle) {
                    func.apply(this, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        };

        let searchTimeout;
        this.searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this.dispatchEvent(new CustomEvent('search', { detail: this.searchInput.value }));
            }, 600);
        });

        // Action Buttons
        this.btnOpenUrlModal.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('action-add-video'));
        });

        this.btnOpenLinkRelayModal.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('action-send-link'));
        });

        this.btnFullscreenTesla.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('action-fullscreen'));
        });

        this.btnOpenSettings.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('action-settings'));
        });
    }

    clearSearch() {
        this.searchInput.value = '';
        this.clearSearchBtn.classList.remove('is-visible');
        this.dispatchEvent(new CustomEvent('search', { detail: '' }));
        this.searchInput.focus();
    }
}

customElements.define('carplayer-navbar', CarplayerNavbar);
