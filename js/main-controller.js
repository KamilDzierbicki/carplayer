export default class MainController {
    #app;
    #storage;
    #historyUI;
    #playerController;
    #jellyfinService;
    #settingsController;
    #shareController;
    #fullscreenRedirectUrl = null;

    constructor(dependencies) {
        this.#app = dependencies.app;
        this.#storage = dependencies.storage;
        this.#historyUI = dependencies.historyUI;
        this.#playerController = dependencies.playerController;
        this.#jellyfinService = dependencies.jellyfinService;
        this.#settingsController = dependencies.settingsController;
        this.#shareController = dependencies.shareController;

        this.#bindMainEvents();
    }

    init() {
        this.#historyUI.render();
    }

    #bindMainEvents() {
        const appNav = document.querySelector("carplayer-navbar");
        if (appNav) {
            appNav.addEventListener("action-add-video", () => {
                this.#app.openUrlModal();
            });

            appNav.addEventListener("action-settings", () => {
                this.#settingsController.openModal();
            });

            appNav.addEventListener("action-fullscreen", () => {
                void this.#toggleFullscreenRedirect();
            });

            // Jellyfin results render inside the History tab.
            appNav.addEventListener("search", (event) => {
                if (event.detail) document.dispatchEvent(new CustomEvent("request-tab", { detail: { tab: "history" } }));
            });
        }

        document.addEventListener("tab-change", (event) => {
            if (event.detail.tab !== "link" || this.#shareController?.isPhoneRelayMode()) return;
            const qrContainer = document.querySelector("carplayer-add-video-flow #qrcode");
            void this.#shareController?.showRelayQr(qrContainer, "share", 220);
        });

        const btnConfirmFullscreenRedirect = document.getElementById("btnConfirmFullscreenRedirect");
        if (btnConfirmFullscreenRedirect) {
            btnConfirmFullscreenRedirect.addEventListener("click", () => {
                if (this.#fullscreenRedirectUrl) {
                    window.location.assign(this.#fullscreenRedirectUrl);
                }
            });
        }

        // <carplayer-modal> components handle their own close buttons and backdrop clicks
        // via the 'modal-close' event — clean up URL params on any modal close
        document.addEventListener('modal-close', (e) => {
            const modalId = e.target?.id;
            if (modalId) {
                this.#cleanUrlParamsOnModalClose();
            }
        });

        const addVideoFlow = document.querySelector("carplayer-add-video-flow");
        const videoUrlInput = addVideoFlow ? addVideoFlow.querySelector("#videoUrl") : null;
        const btnLoad = addVideoFlow ? addVideoFlow.querySelector("#btnLoad") : null;

        if (videoUrlInput && btnLoad) {
            videoUrlInput.addEventListener("input", () => {
                const hasContent = videoUrlInput.value.trim().length > 0;
                btnLoad.classList.toggle("is-disabled", !hasContent);
            });

            videoUrlInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    this.#handleLoadVideo();
                }
            });
        }

        if (btnLoad) {
            btnLoad.addEventListener("click", () => {
                this.#handleLoadVideo();
            });
        }

        const btnPlaySample = addVideoFlow ? addVideoFlow.querySelector("#btnPlaySample") : null;
        if (btnPlaySample) {
            btnPlaySample.addEventListener("click", () => {
                if (videoUrlInput) {
                    // Google's gtv-videos-bucket samples now answer 403; Mux's public test stream sends CORS headers.
                    videoUrlInput.value = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";
                }
                this.#handleLoadVideo(true);
            });
        }

    }

    async #handleLoadVideo(force = false) {
        const addVideoFlow = document.querySelector("carplayer-add-video-flow");
        const videoUrlInput = addVideoFlow ? addVideoFlow.querySelector("#videoUrl") : null;
        if (!videoUrlInput) return;

        const btnLoad = addVideoFlow ? addVideoFlow.querySelector("#btnLoad") : null;
        if (!force && btnLoad && btnLoad.classList.contains("is-disabled")) return;

        const url = videoUrlInput.value.trim();
        if (!url) return;

        try {
            const parsedUrl = new URL(url);
            // Check for jellyfin URLs in input if pasted natively
            if (parsedUrl.href.includes('/Videos/') && parsedUrl.href.includes('/stream')) {
                // We'll treat this as a direct MP4
            }
        } catch {
            // Assume fallback or ID
        }

        await this.#playerController.loadVideo(url);
    }

    #cleanUrlParamsOnModalClose() {
        const params = new URLSearchParams(window.location.search);
        const transient = ['share', 'settings', 'url', 'apikey', 'linkshare', 'captionshare', 'peer', 'ice', 'sid', 'wt', 'relay'];
        let changed = false;
        transient.forEach(key => {
            if (params.has(key)) { params.delete(key); changed = true; }
        });
        if (changed) {
            const qs = params.toString();
            const newUrl = window.location.pathname + (qs ? '?' + qs : '');
            history.replaceState(null, '', newUrl);
        }
    }

    #toggleFullscreenRedirect() {
        const searchParams = new URLSearchParams(window.location.search);
        const hasFsParam = searchParams.get("fs") === "1";

        if (!hasFsParam) {
            const url = new URL(window.location.href);
            url.searchParams.set("fs", "1");
            const finalUrl = `https://www.youtube.com/redirect?q=${encodeURIComponent(url.toString())}`;

            this.#fullscreenRedirectUrl = finalUrl;
            this.#app.openModal("teslaFullscreenModal");
            return;
        }

        const url = new URL(window.location.href);
        url.searchParams.delete("fs");
        window.location.replace(url.toString());
    }
}
