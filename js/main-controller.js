export default class MainController {
    #app;
    #storage;
    #historyUI;
    #playerController;
    #jellyfinService;
    #settingsController;
    #injectedStyle = null;

    constructor(dependencies) {
        this.#app = dependencies.app;
        this.#storage = dependencies.storage;
        this.#historyUI = dependencies.historyUI;
        this.#playerController = dependencies.playerController;
        this.#jellyfinService = dependencies.jellyfinService;
        this.#settingsController = dependencies.settingsController;

        this.#bindMainEvents();
    }

    init() {
        this.#historyUI.render();
    }

    #bindMainEvents() {
        const btnOpenUrlModal = document.getElementById("btnOpenUrlModal");
        if (btnOpenUrlModal) {
            btnOpenUrlModal.addEventListener("click", () => {
                this.#app.openUrlModal();
            });
        }

        const btnOpenSettings = document.getElementById("btnOpenSettings");
        if (btnOpenSettings) {
            btnOpenSettings.addEventListener("click", () => {
                this.#settingsController.openModal();
            });
        }

        const closeButtons = document.querySelectorAll("[data-close-modal]");
        closeButtons.forEach((btn) => {
            btn.addEventListener("click", () => {
                const modalId = btn.dataset.closeModal;
                if (modalId) {
                    this.#app.closeModal(modalId);
                }
            });
        });

        const videoUrlInput = document.getElementById("videoUrl");
        const clearVideoUrlBtn = document.getElementById("clearVideoUrlBtn");
        const btnLoad = document.getElementById("btnLoad");

        if (videoUrlInput && clearVideoUrlBtn && btnLoad) {
            videoUrlInput.addEventListener("input", (e) => {
                const value = e.target.value.trim();
                const hasContent = value.length > 0;
                clearVideoUrlBtn.classList.toggle("is-visible", hasContent);
                btnLoad.classList.toggle("is-disabled", !hasContent);
            });

            clearVideoUrlBtn.addEventListener("click", () => {
                videoUrlInput.value = "";
                clearVideoUrlBtn.classList.remove("is-visible");
                btnLoad.classList.add("is-disabled");
                videoUrlInput.focus();
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

        const btnPlaySample = document.getElementById("btnPlaySample");
        if (btnPlaySample) {
            btnPlaySample.addEventListener("click", () => {
                if (videoUrlInput) {
                    videoUrlInput.value = "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4";
                }
                this.#app.closeModal("urlModal");
                this.#handleLoadVideo(true);
            });
        }

        const btnFullscreenTesla = document.getElementById("btnFullscreenTesla");
        if (btnFullscreenTesla) {
            btnFullscreenTesla.addEventListener("click", () => {
                void this.#toggleFullscreenRedirect();
            });
        }

        window.addEventListener("click", (e) => {
            if (e.target.classList.contains("modal")) {
                e.target.classList.remove("active");
            }
        });

        // Handle dropdown toggles
        this.#bindCustomSelects();
    }

    #bindCustomSelects() {
        const selects = document.querySelectorAll('.custom-select');

        selects.forEach(select => {
            const trigger = select.querySelector('.custom-select__trigger');
            if (!trigger) return;

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = select.classList.contains('is-open');
                selects.forEach(s => s.classList.remove('is-open'));
                if (!isOpen) { select.classList.add('is-open'); }
            });
        });

        window.addEventListener('click', () => {
            selects.forEach(s => s.classList.remove('is-open'));
        });
    }

    async #handleLoadVideo(force = false) {
        const videoUrlInput = document.getElementById("videoUrl");
        if (!videoUrlInput) return;

        const btnLoad = document.getElementById("btnLoad");
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

    #toggleFullscreenRedirect() {
        // Keep Tesla fullscreen logic unchanged
        const searchParams = new URLSearchParams(window.location.search);
        const hasFsParam = searchParams.get("fs") === "1";

        if (!hasFsParam) {
            const url = new URL(window.location.href);
            url.searchParams.set("fs", "1");
            const finalUrl = `https://www.youtube.com/redirect?q=${encodeURIComponent(url.toString())}`;

            this.#showFullscreenTutorial(finalUrl);
            return;
        }

        const url = new URL(window.location.href);
        url.searchParams.delete("fs");
        window.location.replace(url.toString());
    }

    #showFullscreenTutorial(redirectUrl) {
        if (!this.#injectedStyle) {
            this.#injectedStyle = document.createElement("style");
            this.#injectedStyle.textContent = `
        .fullscreen-tutorial-overlay {
          position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
          background: rgba(0,0,0,0.85); z-index: 9999;
          display: flex; justify-content: center; align-items: center;
          opacity: 0; animation: fadeInOverlay 0.3s forwards;
          padding: 24px; box-sizing: border-box; backdrop-filter: blur(8px);
        }
        @keyframes fadeInOverlay { to { opacity: 1; } }
        .tutorial-dialog {
          background: #1e1e24; border-radius: 20px;
          max-width: 500px; width: 100%; padding: 40px 32px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.4); text-align: center;
        }
        .tutorial-dialog__icon { width: 80px; height: 80px; margin: 0 auto 24px auto; }
        .tutorial-dialog__title {
          color: #fff; font-size: 24px; font-weight: 700; margin-bottom: 16px; font-family: 'Montserrat', sans-serif;
        }
        .tutorial-dialog__desc {
          color: #a0a0b0; font-size: 16px; line-height: 1.5; margin-bottom: 32px;
        }
      `;
            document.head.appendChild(this.#injectedStyle);
        }

        const overlay = document.createElement("div");
        overlay.id = "teslaFullscreenModal";
        overlay.className = "modal active";

        overlay.innerHTML = `
      <div class="modal__overlay" data-close-modal="teslaFullscreenModal"></div>
      <div class="modal__content modal__content--settings">
        <button class="modal__close" data-close-modal="teslaFullscreenModal" type="button" aria-label="Close modal">
          <span class="icon icon--sm icon-mask icon-mask--close" aria-hidden="true"></span>
        </button>
        <div style="text-align: center; padding: 1.5rem 0;">
            <svg class="tutorial-dialog__icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 80px; height: 80px; margin: 0 auto 24px auto;">
            <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM11 19.93C7.06 19.43 4 16.05 4 12C4 7.95 7.06 4.57 11 4.07V19.93ZM13 4.07C16.94 4.57 20 7.95 20 12C20 16.05 16.94 19.43 13 19.93V4.07Z" fill="#ff4d4d"/>
            <path d="M16 12L10 16V8L16 12Z" fill="#fff"/>
            </svg>
            <h2 class="modal__title" style="margin-bottom: 1rem;">Going Fullscreen</h2>
            <p class="section-note" style="margin: 0 auto 2rem auto; max-width: 100%;">
            To get true fullscreen on a Tesla display, you will be redirected through YouTube.<br><br>
            When you see the YouTube redirect page, simply tap <b>"Go to Site"</b> on the screen.
            </p>
            <button class="btn btn--primary btn--block btn--lg" id="btnConfirmRedirect">
            Understood, let's go!
            </button>
        </div>
      </div>
    `;

        document.body.appendChild(overlay);

        const btnClose = overlay.querySelector('.modal__close');
        const overlayBg = overlay.querySelector('.modal__overlay');
        const closeModals = () => overlay.remove();

        btnClose.addEventListener('click', closeModals);
        overlayBg.addEventListener('click', closeModals);

        const btnConfirm = overlay.querySelector("#btnConfirmRedirect");
        btnConfirm.addEventListener("click", () => {
            window.location.assign(redirectUrl);
        });
    }
}
