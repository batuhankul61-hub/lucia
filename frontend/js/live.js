// A thin client for the Gemini Live API over a raw WebSocket.
// Protocol reference: https://aistudio.google.com/api-reference/live
//
// The token from our backend already locks the model, system prompt and
// transcription settings, so the setup message only names the model.

const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.{v}.GenerativeService.BidiGenerateContentConstrained";

export class LiveSession extends EventTarget {
  constructor({ token, model, apiVersion = "v1beta" }) {
    super();
    this.token = token;
    this.model = model;
    this.apiVersion = apiVersion;
    this.ws = null;
    this.ready = false;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `${WS_BASE.replace("{v}", this.apiVersion)}?access_token=${encodeURIComponent(this.token)}`;
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.onopen = () => ws.send(JSON.stringify({ setup: { model: `models/${this.model}` } }));
      ws.onmessage = (e) => {
        const msg = parse(e.data);
        if (!msg) return;
        if (msg.setupComplete) {
          this.ready = true;
          resolve();
        }
        this.handle(msg);
      };
      ws.onerror = () => this.emit("error", "WebSocket error");
      ws.onclose = (e) => {
        this.ready = false;
        if (!this.closedByUs && e.code !== 1000) this.emit("error", e.reason || `Connection closed (${e.code})`);
        this.emit("close", { code: e.code, reason: e.reason });
        reject(new Error(e.reason || `Connection closed (${e.code})`));
      };
    });
  }

  handle(msg) {
    const sc = msg.serverContent;
    if (sc) {
      for (const part of sc.modelTurn?.parts ?? []) {
        const data = part.inlineData;
        if (data?.mimeType?.startsWith("audio/pcm")) this.emit("audio", base64ToInt16(data.data));
      }
      if (sc.inputTranscription?.text) this.emit("userText", sc.inputTranscription.text);
      if (sc.outputTranscription?.text) this.emit("tutorText", sc.outputTranscription.text);
      if (sc.interrupted) this.emit("interrupted");
      if (sc.turnComplete) this.emit("turnComplete");
    }
    if (msg.usageMetadata) this.emit("usage", msg.usageMetadata);
    if (msg.goAway) this.emit("goAway", msg.goAway.timeLeft);
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  sendAudio(int16) {
    this.send({ realtimeInput: { audio: { data: int16ToBase64(int16), mimeType: "audio/pcm;rate=16000" } } });
  }

  sendText(text) {
    this.send({ realtimeInput: { text } });
  }

  close() {
    this.closedByUs = true;
    this.send({ realtimeInput: { audioStreamEnd: true } });
    this.ws?.close(1000);
  }
}

function parse(data) {
  try {
    return JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
  } catch {
    return null;
  }
}

function int16ToBase64(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToInt16(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}
