// Bring-your-own-key mode: the learner's own Gemini API key, kept only in this
// browser, does what the backend does in server mode. The key is sent only to
// Google, in a header (never in a URL). The Live session still uses a
// single-use ephemeral token, so the WebSocket URL never carries the key.

import { ApiError } from "./api.js";
import { groundReport, validateReport } from "./grounding.js";
import { liveInstruction, prompts } from "./prompts.js";
import { scenarioById } from "./scenarios.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
// Same defaults as backend/app/config.py.
const LIVE_MODEL = "gemini-3.8-live";
const REPORT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const RETRYABLE = new Set([429, 500, 503]);
const SESSION_MINUTES = 10;
const KEY_STORE = "lucia.geminiKey";

export const ownKey = {
  get() {
    try {
      return localStorage.getItem(KEY_STORE) ?? "";
    } catch {
      return "";
    }
  },
  set(key) {
    try {
      localStorage.setItem(KEY_STORE, key);
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem(KEY_STORE);
    } catch {}
  },
};

async function google(path, body) {
  let res;
  try {
    res = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": ownKey.get() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach Google. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? "Request failed.";
    if (res.status === 400 && /api key/i.test(msg)) throw new ApiError(400, "Google rejected your API key. Check it on the home screen.");
    throw new ApiError(res.status, `Google: ${msg}`);
  }
  return data;
}

/** Same request the backend's GeminiService.create_live_token() sends. */
export async function createTokenWithOwnKey(scenarioId, level) {
  const scenario = scenarioById(scenarioId);
  const now = Date.now();
  const token = await google("auth_tokens", {
    uses: 1,
    expireTime: new Date(now + SESSION_MINUTES * 60_000).toISOString(),
    newSessionExpireTime: new Date(now + 60_000).toISOString(),
    bidiGenerateContentSetup: {
      model: `models/${LIVE_MODEL}`,
      generationConfig: { responseModalities: ["AUDIO"] },
      systemInstruction: { role: "user", parts: [{ text: liveInstruction(scenario, level) }] },
      inputAudioTranscription: { mode: "VERBATIM" },
      outputAudioTranscription: {},
    },
    fieldMask:
      "model,generationConfig.responseModalities,systemInstruction.parts,systemInstruction.role,inputAudioTranscription,outputAudioTranscription",
  });
  return { token: token.name, model: LIVE_MODEL, max_session_minutes: SESSION_MINUTES };
}

/** Same layout as GeminiService.generate_report() in the backend. */
export function reportPrompt(scenarioTitle, level, turns) {
  const transcript = turns.map((t) => `${t.role === "user" ? "LEARNER" : "TUTOR"}: ${t.text}`).join("\n");
  return `Scenario: ${scenarioTitle}. Learner level: ${level}.\n\nTranscript:\n${transcript}`;
}

let schemaPromise = null;

/** Returns the same shape as the backend's POST /api/report. */
export async function createReportWithOwnKey(scenarioId, level, turns) {
  const instruction = prompts().reportInstruction.join("\n");
  const words = turns.filter((t) => t.role === "user").reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);
  if (words < 5) throw new ApiError(422, "Not enough speech to review. Talk a bit more next time.");

  schemaPromise ??= fetch(new URL("../report-schema.json", import.meta.url)).then((r) => r.json());
  const body = {
    systemInstruction: { parts: [{ text: instruction }] },
    contents: [{ role: "user", parts: [{ text: reportPrompt(scenarioById(scenarioId).title, level, turns) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: await schemaPromise },
  };

  let data, model;
  for (const [i, m] of REPORT_MODELS.entries()) {
    model = m;
    try {
      data = await google(`models/${m}:generateContent`, body);
      break;
    } catch (err) {
      if (!RETRYABLE.has(err.status) || i === REPORT_MODELS.length - 1) throw err;
    }
  }

  let report;
  try {
    report = validateReport(JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""));
  } catch {
    throw new ApiError(502, "The report model returned an invalid report.");
  }
  const grounded = groundReport(report, turns);
  const meta = data.usageMetadata ?? {};
  return {
    report: grounded.report,
    dropped_ungrounded: grounded.dropped,
    usage: { model, prompt_tokens: meta.promptTokenCount ?? 0, output_tokens: meta.candidatesTokenCount ?? 0 },
  };
}
