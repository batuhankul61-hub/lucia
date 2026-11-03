// Runs on the audio thread. Plays the tutor's 24 kHz PCM through a ring
// buffer, resampling to the device rate. "clear" empties it instantly, which
// is what makes barge-in feel immediate.

const SOURCE_RATE = 24000;
const CAPACITY = SOURCE_RATE * 90; // 90 s of audio

class PlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(CAPACITY);
    this.write = 0; // absolute sample index
    this.read = 0; // absolute, fractional
    this.step = SOURCE_RATE / sampleRate;
    this.playing = false;
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "push") this.push(msg.samples);
      else if (msg.type === "clear") {
        this.read = this.write;
        this.setPlaying(false);
      }
    };
  }

  push(samples) {
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.write % CAPACITY] = samples[i] / 0x8000;
      this.write++;
    }
    // Never let the writer lap the reader; drop the oldest audio instead.
    if (this.write - this.read > CAPACITY) this.read = this.write - CAPACITY;
  }

  setPlaying(on) {
    if (on === this.playing) return;
    this.playing = on;
    this.port.postMessage({ type: on ? "started" : "drained", at: currentTime });
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      if (this.read + 1 >= this.write) {
        out[i] = 0;
        continue;
      }
      const idx = Math.floor(this.read);
      const frac = this.read - idx;
      const a = this.buf[idx % CAPACITY];
      const b = this.buf[(idx + 1) % CAPACITY];
      out[i] = a + (b - a) * frac;
      this.read += this.step;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    this.setPlaying(this.read + 1 < this.write);
    return true;
  }
}

registerProcessor("player-processor", PlayerProcessor);
