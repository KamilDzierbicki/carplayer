const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const ICE_GATHER_TIMEOUT_MS = 4000;

/**
 * Screen mirroring from a laptop browser to the car.
 *
 * Signaling uses the HTTP relay (one offer and one answer, with all ICE candidates gathered up front).
 * The car never plays the stream in <video>, which the car blocks while driving: video frames are read with
 * MediaStreamTrackProcessor and drawn on a canvas, audio goes to a plain <audio> element.
 * Phones cannot share their screen from a browser (no getDisplayMedia), so the sender side is desktop only.
 */
export default class MirrorController {
  #app;
  #share;
  #panel;
  #screen;
  #canvas;
  #ctx;
  #audio = new Audio();
  #receiver = null;
  #sender = null;

  constructor({ app, share }) {
    this.#app = app;
    this.#share = share;
    this.#panel = document.getElementById("mirrorPanel");
    this.#screen = document.getElementById("mirrorScreen");
    this.#canvas = this.#screen?.querySelector("canvas") || null;
    this.#ctx = this.#canvas?.getContext("2d") || null;

    this.#share.registerMobileMode("mirrorshare", "mirrorSenderModal");
    this.#share.registerPayloadHandler("mirror-offer", (value) => void this.#acceptOffer(value));

    document.addEventListener("tab-change", (event) => {
      if (event.detail.tab === "mirror" && !this.#share.isPhoneRelayMode()) {
        void this.#share.showRelayQr(this.#panel?.querySelector('[data-role="qr"]'), "mirrorshare", 220);
      }
    });
    this.#screen?.querySelector('[data-action="stop-mirror"]')?.addEventListener("click", () => this.#stopReceiver());
    document.getElementById("btnStartMirror")?.addEventListener("click", () => void this.#startSender());
    document.getElementById("btnStopMirror")?.addEventListener("click", () => this.#stopSender("Sharing stopped."));
    document.getElementById("btnShareMirrorLink")?.addEventListener("click", () => void this.#shareLinkToLaptop());
    document.addEventListener("modal-open", (event) => {
      if (event.target?.id !== "mirrorSenderModal" || navigator.mediaDevices?.getDisplayMedia) return;
      // Scanned on a phone: it cannot share its screen, so offer to pass the link on to a laptop.
      document.getElementById("btnStartMirror")?.classList.add("hidden");
      document.getElementById("btnShareMirrorLink")?.classList.remove("hidden");
      this.#setSenderStatus("This device cannot share its screen. Open this page on a laptop instead.");
    });
    document.addEventListener("playback-start", () => this.#stopReceiver());
  }

  // ── Car side ─────────────────────────────────────────

  async #acceptOffer(value) {
    const offerSdp = String(value?.sdp || "");
    const reply = value?.reply;
    if (!offerSdp || !reply?.sessionId || !reply?.writeToken) return;

    this.#stopReceiver();
    this.#setPanelStatus("Laptop found. Connecting...");

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.#receiver = { pc, stopRender: null };

    pc.addEventListener("track", (event) => {
      if (event.track.kind === "video") this.#renderVideoTrack(event.track);
      if (event.track.kind === "audio") {
        this.#audio.srcObject = new MediaStream([event.track]);
        this.#audio.play().catch((error) => console.warn("[Mirror] audio autoplay blocked", error));
      }
    });
    pc.addEventListener("connectionstatechange", () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        this.#setPanelStatus(pc.connectionState === "failed"
          ? "Connection failed. Both devices may be behind strict networks."
          : "Mirroring ended.");
        this.#stopReceiver();
      }
    });

    try {
      await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitForIceGathering(pc);
      const sent = await this.#share.sendToSession(reply, { type: "mirror-answer", value: { sdp: pc.localDescription.sdp } });
      if (!sent) throw new Error("Could not send the answer to the laptop.");
    } catch (error) {
      console.error("[Mirror] receiver failed", error);
      this.#setPanelStatus(`Mirroring failed: ${error.message}`);
      this.#stopReceiver();
    }
  }

  #renderVideoTrack(track) {
    document.dispatchEvent(new CustomEvent("mirror-start"));
    this.#screen?.classList.remove("hidden");
    this.#setPanelStatus("Mirroring active.");

    let stopped = false;
    const draw = (source, width, height) => {
      if (this.#canvas.width !== width || this.#canvas.height !== height) {
        this.#canvas.width = width;
        this.#canvas.height = height;
      }
      this.#ctx.drawImage(source, 0, 0, width, height);
    };

    if (typeof window.MediaStreamTrackProcessor === "function") {
      const reader = new window.MediaStreamTrackProcessor({ track }).readable.getReader();
      (async () => {
        while (!stopped) {
          const { value: frame, done } = await reader.read();
          if (done) break;
          draw(frame, frame.displayWidth, frame.displayHeight);
          frame.close();
        }
      })().catch((error) => console.warn("[Mirror] frame reader stopped", error));
      this.#receiver.stopRender = () => {
        stopped = true;
        void reader.cancel();
      };
    } else {
      // Fallback for browsers without MediaStreamTrackProcessor; a detached <video> may be blocked while driving.
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream([track]);
      void video.play();
      const loop = () => {
        if (stopped) return;
        if (video.videoWidth) draw(video, video.videoWidth, video.videoHeight);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      this.#receiver.stopRender = () => {
        stopped = true;
        video.srcObject = null;
      };
    }
    track.addEventListener("ended", () => this.#stopReceiver());
  }

  #stopReceiver() {
    if (!this.#receiver) return;
    const { pc, stopRender } = this.#receiver;
    this.#receiver = null;
    stopRender?.();
    pc.close();
    this.#audio.pause();
    this.#audio.srcObject = null;
    this.#screen?.classList.add("hidden");
    this.#ctx?.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
  }

  #setPanelStatus(text) {
    const status = this.#panel?.querySelector('[data-role="status"]');
    if (status) status.textContent = text;
  }

  // ── Laptop side ──────────────────────────────────────

  async #startSender() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.#setSenderStatus("This browser cannot share its screen. Use Chrome, Edge or Firefox on a computer.");
      return;
    }
    this.#stopSender();

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
        audio: true,
      });
    } catch (error) {
      this.#setSenderStatus(`Screen sharing was not started (${error.message}).`);
      return;
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.#sender = { pc, stream, channel: null };
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
      track.addEventListener("ended", () => this.#stopSender("Sharing stopped."));
    });
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "connected") this.#setSenderStatus("Connected. Your screen is on the car display.");
      if (pc.connectionState === "failed") this.#stopSender("Connection failed. Both devices may be behind strict networks.");
    });

    try {
      this.#setSenderStatus("Connecting to the car...");
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIceGathering(pc);

      const channel = await this.#share.openReplyChannel(async (payload) => {
        if (payload?.type !== "mirror-answer" || !this.#sender || this.#sender.pc !== pc) return;
        this.#sender.channel?.close();
        await pc.setRemoteDescription({ type: "answer", sdp: String(payload.value?.sdp || "") });
      });
      this.#sender.channel = channel;

      const sent = await this.#share.sendPayloadToCar({
        type: "mirror-offer",
        value: { sdp: pc.localDescription.sdp, reply: channel.target },
      });
      if (!sent) throw new Error("Could not reach the car. Scan the QR code from the car again.");
      this.#setSenderStatus("Waiting for the car to answer...");
      this.#toggleSenderButtons(true);
    } catch (error) {
      console.error("[Mirror] sender failed", error);
      this.#stopSender(`Mirroring failed: ${error.message}`);
    }
  }

  async #shareLinkToLaptop() {
    const link = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: "CarPlayer screen mirroring", url: link });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    this.#app.fallbackCopyText(link);
  }

  #stopSender(status = "") {
    if (this.#sender) {
      this.#sender.channel?.close();
      this.#sender.stream.getTracks().forEach((track) => track.stop());
      this.#sender.pc.close();
      this.#sender = null;
    }
    this.#toggleSenderButtons(false);
    if (status) this.#setSenderStatus(status);
  }

  #toggleSenderButtons(active) {
    document.getElementById("btnStartMirror")?.classList.toggle("hidden", active);
    document.getElementById("btnStopMirror")?.classList.toggle("hidden", !active);
  }

  #setSenderStatus(text) {
    const status = document.getElementById("mirrorSenderStatus");
    if (status) status.textContent = text;
  }
}

function waitForIceGathering(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", check);
  });
}
