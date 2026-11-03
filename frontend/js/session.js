// One practice conversation: wires the microphone, the Live session, the
// speaker and the transcript together, and measures it.

import { createToken } from "./api.js";
import { AudioIO } from "./audio/audio-io.js";
import { LiveSession } from "./live.js";
import { SessionMetrics } from "./metrics.js";
import { Transcript } from "./transcript.js";

// In speaker mode, mic audio is only sent while the tutor talks if it's
// clearly louder than the echo, so the tutor doesn't interrupt itself but a
// learner can still cut in by speaking up.
const SPEAKER_GATE_RMS = 0.08;
const ECHO_TAIL_MS = 400;
const KICKOFF = "(The learner has joined. Greet them in character and start the scenario.)";

export class Conversation extends EventTarget {
  constructor({ scenarioId, level, speakerMode = false, fakeSource = null }) {
    super();
    Object.assign(this, { scenarioId, level, speakerMode, fakeSource });
    this.audio = new AudioIO();
    this.transcript = new Transcript((turn) => this.emit("turn", turn));
    this.state = "idle";
    this.tutorPlaying = false;
    this.drainedAt = 0;
    this.replyStarted = false;
    this.ended = false;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setState(state) {
    this.state = state;
    this.emit("state", state);
  }

  get tutorSpeaking() {
    return this.tutorPlaying || performance.now() - this.drainedAt < ECHO_TAIL_MS;
  }

  /** Call from a tap handler: iOS only allows audio to start inside a user gesture. */
  async start() {
    this.setState("connecting");
    this.startedAt = Date.now();
    this.audio.onChunk = (c) => this.onMic(c);
    this.audio.onPlayback = (e) => this.onPlayback(e);
    await this.audio.start({ fakeSource: this.fakeSource });

    const { token, model, max_session_minutes } = await createToken(this.scenarioId, this.level);
    this.metrics = new SessionMetrics(model);
    this.maxMs = max_session_minutes * 60_000;

    this.live = new LiveSession({ token, model });
    this.live.addEventListener("audio", (e) => this.onTutorAudio(e.detail));
    this.live.addEventListener("userText", (e) => this.transcript.addUser(e.detail));
    this.live.addEventListener("tutorText", (e) => this.transcript.addTutor(e.detail));
    this.live.addEventListener("interrupted", () => this.onInterrupted());
    this.live.addEventListener("turnComplete", () => this.onTurnComplete());
    this.live.addEventListener("usage", (e) => this.metrics.addUsage(e.detail));
    this.live.addEventListener("goAway", () => this.emit("notice", "The voice session is about to time out."));
    this.live.addEventListener("error", (e) => !this.ended && this.emit("error", e.detail));
    this.live.addEventListener("close", () => !this.ended && this.emit("dropped"));

    await this.live.connect();
    this.metrics.connected();
    this.setState("listening");
    this.live.sendText(KICKOFF);
    this.timer = setTimeout(() => this.emit("timeup"), this.maxMs);
  }

  onMic({ pcm, rms }) {
    this.emit("level", rms);
    if (!this.live?.ready) return;
    const speaking = this.tutorSpeaking;
    this.metrics.micChunk(rms, speaking);
    if (this.speakerMode && speaking && rms < SPEAKER_GATE_RMS) pcm.fill(0);
    this.live.sendAudio(pcm);
  }

  onTutorAudio(int16) {
    if (!this.replyStarted) {
      this.replyStarted = true;
      this.metrics.tutorAudioStarted();
    }
    this.audio.play(int16);
  }

  onPlayback({ type }) {
    this.tutorPlaying = type === "started";
    if (type === "drained") this.drainedAt = performance.now();
    if (!this.ended && this.live?.ready) this.setState(this.tutorPlaying ? "speaking" : "listening");
  }

  onInterrupted() {
    this.audio.clearPlayback();
    this.metrics.interrupted();
    this.transcript.interrupt();
    this.replyStarted = false;
  }

  onTurnComplete() {
    this.transcript.completeTurn(this.speakerMode);
    this.replyStarted = false;
  }

  /** Stops everything and returns what's needed for the report and history. */
  async end() {
    if (this.ended) return null;
    this.ended = true;
    clearTimeout(this.timer);
    this.transcript.completeTurn(this.speakerMode);
    this.live?.close();
    await this.audio.stop();
    this.setState("ended");
    return {
      startedAt: this.startedAt,
      turns: this.transcript.turns.filter((t) => t.text.trim()),
      reportTurns: this.transcript.forReport(),
      metrics: this.metrics,
    };
  }
}
