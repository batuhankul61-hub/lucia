// Microphone in, tutor voice out, sharing one AudioContext (iOS Safari
// behaves best with a single context created inside a user gesture).

export class AudioIO {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.mic = null;
    this.player = null;
    this.onChunk = () => {};
    this.onPlayback = () => {};
  }

  /** Must be called from a click/tap handler. `fakeSource` is a URL of a speech
   * recording used instead of the microphone (manual testing only). */
  async start({ fakeSource } = {}) {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    if (this.ctx.state === "suspended") await this.ctx.resume();

    await Promise.all([
      this.ctx.audioWorklet.addModule(new URL("./mic-worklet.js", import.meta.url)),
      this.ctx.audioWorklet.addModule(new URL("./player-worklet.js", import.meta.url)),
    ]);

    this.player = new AudioWorkletNode(this.ctx, "player-processor", { outputChannelCount: [1] });
    this.player.port.onmessage = (e) => this.onPlayback(e.data);
    this.player.connect(this.ctx.destination);

    let source;
    if (fakeSource) {
      const el = new Audio(fakeSource);
      el.crossOrigin = "anonymous";
      source = this.ctx.createMediaElementSource(el);
      this.fakeEl = el;
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      source = this.ctx.createMediaStreamSource(this.stream);
    }

    this.mic = new AudioWorkletNode(this.ctx, "mic-processor", { numberOfInputs: 1, numberOfOutputs: 0 });
    this.mic.port.onmessage = (e) => this.onChunk(e.data);
    source.connect(this.mic);
    if (this.fakeEl) this.fakeEl.play();
  }

  play(int16) {
    this.player?.port.postMessage({ type: "push", samples: int16 }, [int16.buffer]);
  }

  clearPlayback() {
    this.player?.port.postMessage({ type: "clear" });
  }

  async stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.fakeEl?.pause();
    this.mic?.disconnect();
    this.player?.disconnect();
    if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();
    this.ctx = this.stream = this.mic = this.player = this.fakeEl = null;
  }
}
