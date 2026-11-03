// Runs on the audio thread. Turns microphone audio at the device rate
// (usually 48 kHz, 44.1 kHz on some iPhones) into 16 kHz 16-bit PCM, which is
// what the Live API expects, and posts ~32 ms chunks to the main thread.

const TARGET_RATE = 16000;
const CHUNK = 512; // samples at 16 kHz = 32 ms

class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE;
    this.pos = 0;
    this.acc = 0;
    this.count = 0;
    this.out = new Int16Array(CHUNK);
    this.n = 0;
    this.peak = 0;
  }

  process(inputs) {
    const input = inputs[0][0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      const s = input[i];
      this.acc += s;
      this.count++;
      this.peak = Math.max(this.peak, Math.abs(s));
      // Averaging the samples that fall into one output slot is a cheap
      // low-pass filter, enough for speech recognition.
      if (++this.pos >= this.step) {
        this.pos -= this.step;
        const v = Math.max(-1, Math.min(1, this.acc / this.count));
        this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        this.acc = 0;
        this.count = 0;
        if (this.n === CHUNK) this.flush();
      }
    }
    return true;
  }

  flush() {
    let sum = 0;
    for (let i = 0; i < CHUNK; i++) sum += (this.out[i] / 0x8000) ** 2;
    const pcm = this.out;
    this.port.postMessage({ pcm, rms: Math.sqrt(sum / CHUNK), peak: this.peak }, [pcm.buffer]);
    this.out = new Int16Array(CHUNK);
    this.n = 0;
    this.peak = 0;
  }
}

registerProcessor("mic-processor", MicProcessor);
