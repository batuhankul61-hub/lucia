// Latency, usage and cost measurement for one conversation.

// Paid-tier prices in USD per 1M tokens, from https://aistudio.google.com/docs/pricing
// (checked Nov 2026). The free tier costs nothing; these show what the same
// conversation would cost on the paid tier.
export const PRICES = {
  "gemini-3.8-live": { in: { TEXT: 0.75, AUDIO: 3.0 }, out: { TEXT: 4.5, AUDIO: 12.0 } },
  "gemini-3.5-flash-lite": { in: { TEXT: 0.3 }, out: { TEXT: 2.5 } },
  "gemini-3.1-flash-lite": { in: { TEXT: 0.25 }, out: { TEXT: 1.5 } },
};

// Microphone level above which we count a chunk as speech (RMS, 0..1).
export const VOICE_RMS = 0.02;

// A reply that starts less than this after the learner's last voiced chunk
// means the learner was still talking: the model jumped in mid-sentence.
// That's counted as an overlap, not as a (meaninglessly tiny) reply delay.
const OVERLAP_MS = 200;

export class SessionMetrics {
  constructor(liveModel) {
    this.liveModel = liveModel;
    this.startedAt = performance.now();
    this.connectMs = null;
    this.firstAudioMs = null;
    this.turnLatencies = [];
    this.bargeIns = 0;
    this.overlaps = 0;
    this.lastVoiceAt = null;
    this.awaitingReply = false;
    this.usage = { prompt: {}, response: {}, total: 0 };
  }

  connected() {
    this.connectMs = Math.round(performance.now() - this.startedAt);
  }

  micChunk(rms, tutorSpeaking) {
    if (rms > VOICE_RMS && !tutorSpeaking) {
      this.lastVoiceAt = performance.now();
      this.awaitingReply = true;
    }
  }

  /** First audio chunk of a tutor turn: user-perceived response time is
   * measured from the learner's last voiced audio chunk. */
  tutorAudioStarted() {
    const now = performance.now();
    if (this.firstAudioMs === null) this.firstAudioMs = Math.round(now - this.startedAt);
    if (this.awaitingReply && this.lastVoiceAt) {
      const delay = Math.round(now - this.lastVoiceAt);
      if (delay < OVERLAP_MS) this.overlaps++;
      else this.turnLatencies.push(delay);
    }
    this.awaitingReply = false;
  }

  interrupted() {
    this.bargeIns++;
  }

  /** The Live API reports usage per model turn; each turn re-reads the
   * context, so summing the turns gives the billed total. */
  addUsage(meta) {
    for (const [key, details] of [
      ["prompt", meta.promptTokensDetails],
      ["response", meta.responseTokensDetails],
    ]) {
      for (const d of details ?? []) {
        this.usage[key][d.modality] = (this.usage[key][d.modality] ?? 0) + (d.tokenCount ?? 0);
      }
    }
    // Thinking tokens aren't in responseTokensDetails but are billed as text output.
    if (meta.thoughtsTokenCount) {
      this.usage.response.THOUGHTS = (this.usage.response.THOUGHTS ?? 0) + meta.thoughtsTokenCount;
    }
    this.usage.total += meta.totalTokenCount ?? 0;
  }

  summary(reportUsage) {
    const sorted = [...this.turnLatencies].sort((a, b) => a - b);
    const liveCost = cost(PRICES[this.liveModel], this.usage.prompt, this.usage.response);
    const reportCost = reportUsage
      ? cost(PRICES[reportUsage.model], { TEXT: reportUsage.prompt_tokens }, { TEXT: reportUsage.output_tokens })
      : 0;
    return {
      durationMs: Math.round(performance.now() - this.startedAt),
      connectMs: this.connectMs,
      firstAudioMs: this.firstAudioMs,
      turnLatencies: this.turnLatencies,
      medianLatencyMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      bargeIns: this.bargeIns,
      overlaps: this.overlaps,
      liveModel: this.liveModel,
      liveTokens: { prompt: this.usage.prompt, response: this.usage.response, total: this.usage.total },
      reportTokens: reportUsage ? reportUsage.prompt_tokens + reportUsage.output_tokens : 0,
      costUsd: liveCost + reportCost,
    };
  }
}

function cost(price, prompt, response) {
  if (!price) return 0;
  const side = (rates, counts) =>
    // Modalities without their own price (e.g. THOUGHTS) are billed at the text rate.
    Object.entries(counts).reduce((sum, [mod, n]) => sum + (n * (rates[mod] ?? rates.TEXT ?? 0)) / 1e6, 0);
  return side(price.in, prompt) + side(price.out, response);
}
