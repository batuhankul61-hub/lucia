// Builds the two-sided transcript from streamed transcription pieces.
//
// The learner's transcription often arrives *after* the tutor has started
// answering, so a learner turn stays open until the tutor's turn completes and
// late pieces are appended to it rather than starting a new bubble.

const ECHO_WINDOW_MS = 20000;
const ECHO_SCORE = 0.6;
const KEEP_SHORT = /^(stop|wait|sorry|yes|no|ok|okay|what|pardon)( \w+)?$/;

export class Transcript {
  constructor(onChange) {
    this.turns = [];
    this.openUser = null;
    this.openTutor = null;
    this.onChange = onChange;
  }

  addUser(piece, now = Date.now()) {
    if (!this.openUser) {
      this.openUser = { role: "user", text: "", at: now };
      // Place it before a tutor reply that's already streaming.
      const i = this.openTutor ? this.turns.indexOf(this.openTutor) : this.turns.length;
      this.turns.splice(i, 0, this.openUser);
    }
    this.openUser.text += piece;
    this.onChange(this.openUser);
  }

  addTutor(piece, now = Date.now()) {
    if (!this.openTutor) {
      this.openTutor = { role: "tutor", text: "", at: now };
      this.turns.push(this.openTutor);
    }
    this.openTutor.text += piece;
    this.onChange(this.openTutor);
  }

  /** Marks the tutor turn as cut off by the learner (barge-in). */
  interrupt() {
    if (this.openTutor) {
      this.openTutor.interrupted = true;
      this.onChange(this.openTutor);
    }
  }

  completeTurn(echoFilter = false, now = Date.now()) {
    const user = this.openUser;
    if (user) {
      user.text = user.text.trim();
      if (echoFilter && this.isEcho(user.text, now)) user.echo = true;
      this.onChange(user);
    }
    if (this.openTutor) this.openTutor.text = this.openTutor.text.trim();
    this.openUser = this.openTutor = null;
  }

  /** On a loudspeaker the mic can pick up the tutor's own voice, which then
   * shows up as "learner" speech. Same idea as the self-hearing filter in my
   * Jarvis phone page: if most words match what the tutor said in the last
   * 20 s, treat it as echo. Short real replies like "yes" or "stop" are kept. */
  isEcho(text, now = Date.now()) {
    const heard = words(text);
    if (heard.length < 3 || KEEP_SHORT.test(heard.join(" "))) return false;
    const said = new Set(
      this.turns
        .filter((t) => t.role === "tutor" && now - t.at < ECHO_WINDOW_MS)
        .flatMap((t) => words(t.text)),
    );
    if (!said.size) return false;
    return heard.filter((w) => said.has(w)).length / heard.length >= ECHO_SCORE;
  }

  /** Turns that go into the report: no echo, no empty lines. */
  forReport() {
    return this.turns
      .filter((t) => t.text.trim() && !t.echo)
      .map((t) => ({ role: t.role, text: t.text.trim() }));
  }
}

function words(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
}
