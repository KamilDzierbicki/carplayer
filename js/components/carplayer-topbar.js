export default class CarplayerTopbar extends HTMLElement {
    static get observedAttributes() {
        return ["video-title"];
    }

    connectedCallback() {
        if (!this.innerHTML.trim()) {
            this.#render();
        }
    }

    attributeChangedCallback(name, oldVal, newVal) {
        if (name === "video-title" && oldVal !== newVal) {
            if (this.isConnected) {
                this.#updateTitle(newVal);
            }
        }
    }

    #render() {
        const title = this.getAttribute("video-title") || "";
        this.innerHTML = `
      <div class="player-topbar" id="internalTopBar">
        <button class="btn btn--glass btn--back" id="internalBtnBack" type="button">
          <span class="icon icon--sm icon-mask icon-mask--back" aria-hidden="true"></span>
          Back
        </button>
        <div id="internalVideoTitleOverlay" class="player-title">${this.#escapeHtml(title)}</div>
      </div>
    `;
        this.#bindEvents();
    }

    #updateTitle(title) {
        const titleEl = this.querySelector("#internalVideoTitleOverlay");
        if (titleEl) {
            titleEl.textContent = title;
        }
    }

    #bindEvents() {
        const backBtn = this.querySelector("#internalBtnBack");
        if (backBtn) {
            backBtn.addEventListener("click", () => {
                this.dispatchEvent(new CustomEvent("back", { bubbles: true, composed: true }));
            });
        }
    }

    setIdle(idle) {
        const topBar = this.querySelector("#internalTopBar");
        if (topBar) {
            if (idle) {
                topBar.classList.add("idle");
            } else {
                topBar.classList.remove("idle");
            }
        }
    }

    // Simple HTML escaper to prevent injection if title comes from untrusted source
    #escapeHtml(unsafe) {
        return (unsafe || "").replace(/[&<"'>]/g, (match) => {
            const escape = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return escape[match];
        });
    }
}

customElements.define("carplayer-topbar", CarplayerTopbar);
