const IMPORT_PARAM = "importsettings";
// qrcodejs at error correction level L holds about 2900 characters; keep a margin.
const MAX_QR_URL_CHARS = 2600;

/**
 * Moves settings between devices with QR codes:
 * - export to phone: the QR code holds a link with the compressed settings, scanning it imports them on the phone;
 * - import from phone: the car shows a relay QR code, the phone sends its own settings back.
 * History and playback positions are not transferred (see StorageService.exportSettings).
 */
export default class SettingsTransferController {
  #app;
  #storage;
  #share;

  constructor({ app, storage, share }) {
    this.#app = app;
    this.#storage = storage;
    this.#share = share;

    this.#share.registerMobileMode("settingsimport", "settingsSenderModal");
    this.#share.registerPayloadHandler("settings-import", (value) => this.#importOnCar(value));

    document.getElementById("btnOpenTransfer")?.addEventListener("click", () => {
      this.#app.closeModal("settingsModal");
      this.#app.openModal("transferModal");
    });
    document.addEventListener("modal-open", (event) => {
      if (event.target?.id === "transferModal") void this.#renderTransferModal();
    });
    document.getElementById("btnSendSettingsToCar")?.addEventListener("click", () => void this.#sendFromPhone());
  }

  /** Phone side: a scanned export link imports settings once and cleans the address bar. */
  async handleImportLink() {
    // Settings travel after "#", which browsers never send to the server, so keys stay out of access logs.
    // Older export links used "?importsettings=" and are still accepted.
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const params = new URLSearchParams(window.location.search);
    const encoded = hashParams.get(IMPORT_PARAM) || params.get(IMPORT_PARAM);
    if (!encoded) return;

    params.delete(IMPORT_PARAM);
    const query = params.toString();
    history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));

    try {
      const snapshot = JSON.parse(await inflateBase64Url(encoded));
      const count = Object.keys(snapshot).length;
      if (!confirm(`Import ${count} settings from the car? Settings on this device will be replaced.`)) return;
      this.#storage.importSettings(snapshot);
      window.location.reload();
    } catch (error) {
      console.error("[Transfer] import link failed", error);
      alert("This settings link is damaged or incomplete.");
    }
  }

  async #renderTransferModal() {
    const exportBox = document.getElementById("exportSettingsQr");
    const importBox = document.getElementById("importSettingsQr");

    if (exportBox) {
      const url = new URL(window.location.pathname, window.location.origin);
      url.hash = `${IMPORT_PARAM}=${await deflateBase64Url(JSON.stringify(this.#storage.exportSettings()))}`;
      exportBox.replaceChildren();
      if (url.href.length > MAX_QR_URL_CHARS) {
        exportBox.textContent = "Your settings are too large for one QR code. Remove some radio favorites or tasks and try again.";
      } else {
        new QRCode(exportBox, {
          text: url.href,
          width: 240,
          height: 240,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.L,
        });
        exportBox.querySelector("img")?.setAttribute("alt", "QR code with your settings for the phone");
      }
    }

    if (importBox) await this.#share.showRelayQr(importBox, "settingsimport", 200);
  }

  async #sendFromPhone() {
    const snapshot = this.#storage.exportSettings();
    if (!Object.keys(snapshot).length) {
      alert("This device has no settings to send yet.");
      return;
    }
    if (await this.#share.sendPayloadToCar({ type: "settings-import", value: snapshot })) {
      this.#app.closeModal("settingsSenderModal");
      alert("Settings sent to the car.");
    }
  }

  #importOnCar(snapshot) {
    const count = snapshot && typeof snapshot === "object" ? Object.keys(snapshot).length : 0;
    if (!count) return;
    if (!confirm(`Import ${count} settings from your phone? Settings in the car will be replaced.`)) return;
    this.#storage.importSettings(snapshot);
    window.location.reload();
  }
}

async function deflateBase64Url(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function inflateBase64Url(encoded) {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}
