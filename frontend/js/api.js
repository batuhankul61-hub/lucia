// Calls to the Mario backend. The Gemini API key never reaches the browser;
// the backend hands out a short-lived, single-use token instead.

const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
export const API_BASE = LOCAL ? `http://${location.hostname}:8000` : "https://mario-api.onrender.com";

const CODE_KEY = "mario.accessCode";

export const accessCode = {
  get: () => safe(() => localStorage.getItem(CODE_KEY)) ?? "",
  set: (v) => safe(() => localStorage.setItem(CODE_KEY, v)),
};

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function post(path, body) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Access-Code": accessCode.get() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, typeof data.detail === "string" ? data.detail : "Request failed.");
  return data;
}

export const createToken = (scenarioId, level) => post("/api/token", { scenario_id: scenarioId, level });
export const createReport = (scenarioId, level, turns) =>
  post("/api/report", { scenario_id: scenarioId, level, turns });

/** Free-tier hosts sleep when idle; ping early so the server is awake by the
 * time the learner taps a scenario. */
export function warmUp() {
  fetch(API_BASE + "/health", { cache: "no-store" }).catch(() => {});
}
