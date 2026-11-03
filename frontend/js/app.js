import { ApiError, accessCode, createReport, warmUp } from "./api.js";
import { progressChart } from "./chart.js";
import { deleteSession, getSession, listSessions, saveSession } from "./db.js";
import { LEVELS, SCENARIOS, scenarioById } from "./scenarios.js";
import { Conversation } from "./session.js";

const view = document.getElementById("view");
const prefs = {
  get(key, fallback) {
    try {
      return localStorage.getItem(`mario.${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`mario.${key}`, value);
    } catch {}
  },
};
// ?fake=<audio url> replaces the microphone with a recording (manual testing).
const fakeSource = new URLSearchParams(location.search).get("fake");

let conversation = null;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtMs = (ms) => (ms == null ? "–" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const fmtDuration = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const fmtUsd = (v) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);
const fmtDate = (t) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// ---------- routing ----------

const routes = [
  [/^#\/?$/, renderHome],
  [/^#\/talk\/([\w-]+)$/, renderTalk],
  [/^#\/report\/([\w-]+)$/, renderReport],
  [/^#\/history$/, renderHistory],
  [/^#\/metrics$/, renderMetrics],
];

async function route() {
  const hash = location.hash || "#/";
  if (conversation && !hash.startsWith("#/talk/")) await finishConversation();
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      document.querySelectorAll(".tabs a").forEach((a) => a.toggleAttribute("aria-current", hash.startsWith(a.getAttribute("href")) && (a.getAttribute("href") !== "#/" || hash === "#/")));
      window.scrollTo(0, 0);
      return fn(...m.slice(1));
    }
  }
  location.hash = "#/";
}

// ---------- home ----------

function renderHome() {
  const level = prefs.get("level", "B1");
  const speaker = prefs.get("speaker", matchMedia("(pointer: coarse)").matches ? "1" : "0") === "1";
  view.innerHTML = `
    <header class="hero">
      <h1>Hi, I'm Mario.</h1>
      <p>Pick a situation and talk it through out loud. You'll get a short report on your English when you finish.</p>
    </header>
    ${navigator.onLine ? "" : `<p class="banner">You're offline. History and metrics still work; conversations need internet.</p>`}
    <section aria-labelledby="level-h">
      <h2 id="level-h" class="label">Your level</h2>
      <div class="segmented" role="radiogroup">
        ${LEVELS.map((l) => `<button role="radio" aria-checked="${l === level}" data-level="${l}">${l}</button>`).join("")}
      </div>
    </section>
    <section aria-labelledby="sc-h">
      <h2 id="sc-h" class="label">Situations</h2>
      <ul class="cards">
        ${SCENARIOS.map(
          (s) => `
          <li><a class="card" href="#/talk/${s.id}">
            <span class="icon icon-${s.icon}" aria-hidden="true"></span>
            <span><strong>${esc(s.title)}</strong><small>${esc(s.blurb)}</small></span>
          </a></li>`,
        ).join("")}
      </ul>
    </section>
    <label class="toggle">
      <input type="checkbox" id="speaker" ${speaker ? "checked" : ""}>
      <span><strong>Speaker mode</strong><small>Turn on if you're not wearing headphones, so Mario doesn't hear himself.</small></span>
    </label>`;

  view.querySelectorAll("[data-level]").forEach((b) =>
    b.addEventListener("click", () => {
      prefs.set("level", b.dataset.level);
      view.querySelectorAll("[data-level]").forEach((x) => x.setAttribute("aria-checked", x === b));
    }),
  );
  view.querySelector("#speaker").addEventListener("change", (e) => prefs.set("speaker", e.target.checked ? "1" : "0"));
}

// ---------- conversation ----------

const STATE_LABEL = { connecting: "Connecting…", listening: "Listening", speaking: "Mario is speaking", ended: "Finished" };

async function renderTalk(scenarioId) {
  const scenario = scenarioById(scenarioId);
  if (!scenario) return (location.hash = "#/");

  view.innerHTML = `
    <div class="talk">
      <header class="talk-head">
        <div><h1>${esc(scenario.title)}</h1><p class="muted">Level ${esc(prefs.get("level", "B1"))}</p></div>
        <span class="clock" id="clock">0:00</span>
      </header>
      <div class="status" id="status" data-state="idle"><span class="dot"></span><span id="status-text">Ready</span></div>
      <ol class="transcript" id="transcript" aria-live="polite"></ol>
      <div class="talk-foot" id="foot"></div>
    </div>`;

  const foot = view.querySelector("#foot");
  if (!navigator.onLine) {
    foot.innerHTML = `<p class="banner">You're offline. Conversations need an internet connection.</p><a class="btn" href="#/">Back</a>`;
    return;
  }
  // Starting needs a tap of its own: browsers only allow the microphone and
  // audio playback to begin inside a user gesture.
  foot.innerHTML = `<button class="btn primary big" id="go">Start talking</button>
    <p class="muted center">Mario speaks first. Interrupt him any time, just like a real conversation.</p>`;
  foot.querySelector("#go").addEventListener("click", () => startConversation(scenario), { once: true });
}

async function startConversation(scenario) {
  const foot = view.querySelector("#foot");
  const list = view.querySelector("#transcript");
  const status = view.querySelector("#status");
  const bubbles = new Map();

  conversation = new Conversation({
    scenarioId: scenario.id,
    level: prefs.get("level", "B1"),
    speakerMode: prefs.get("speaker", "0") === "1",
    fakeSource,
  });
  const conv = conversation;

  foot.innerHTML = `<div class="meter" aria-hidden="true"><span id="meter"></span></div>
    <button class="btn danger big" id="end">End and get my report</button>`;
  foot.querySelector("#end").addEventListener("click", () => finishConversation());
  const meter = foot.querySelector("#meter");

  conv.addEventListener("state", (e) => {
    status.dataset.state = e.detail;
    status.querySelector("#status-text").textContent = STATE_LABEL[e.detail] ?? e.detail;
  });
  conv.addEventListener("level", (e) => (meter.style.transform = `scaleX(${Math.min(1, e.detail * 8)})`));
  conv.addEventListener("turn", (e) => {
    const turn = e.detail;
    let li = bubbles.get(turn);
    if (!li) {
      li = document.createElement("li");
      bubbles.set(turn, li);
      // Late learner transcription can belong before the tutor's bubble.
      const idx = conv.transcript.turns.indexOf(turn);
      const next = conv.transcript.turns.slice(idx + 1).map((t) => bubbles.get(t)).find(Boolean);
      list.insertBefore(li, next ?? null);
    }
    li.className = `bubble ${turn.role}${turn.interrupted ? " cut" : ""}${turn.echo ? " echo" : ""}`;
    li.textContent = turn.text;
    if (turn.echo) li.title = "Ignored: this looked like Mario's own voice picked up by the mic.";
    list.scrollTop = list.scrollHeight;
  });
  conv.addEventListener("notice", (e) => toast(e.detail));
  conv.addEventListener("timeup", () => {
    toast("Time's up for this session.");
    finishConversation();
  });
  conv.addEventListener("dropped", () => {
    toast("The connection dropped. Saving what we have.");
    finishConversation();
  });
  conv.addEventListener("error", (e) => toast(String(e.detail)));

  const clock = view.querySelector("#clock");
  const tick = setInterval(() => {
    if (conv.ended) return clearInterval(tick);
    clock.textContent = fmtDuration(Date.now() - (conv.startedAt ?? Date.now()));
  }, 500);

  try {
    await conv.start();
  } catch (err) {
    await conv.end();
    conversation = null;
    if (err instanceof ApiError && err.status === 401) return askAccessCode(() => renderTalk(scenario.id));
    const msg =
      err?.name === "NotAllowedError"
        ? "Microphone access was blocked. Allow it in your browser settings and try again."
        : err?.message || "Couldn't start the conversation.";
    foot.innerHTML = `<p class="banner error">${esc(msg)}</p><a class="btn" href="#/">Back</a>`;
  }
}

async function finishConversation() {
  const conv = conversation;
  if (!conv) return;
  conversation = null;
  const result = await conv.end();
  if (!result || !result.turns.length) {
    if (location.hash.startsWith("#/talk/")) location.hash = "#/";
    return;
  }

  const session = {
    id: crypto.randomUUID(),
    scenarioId: conv.scenarioId,
    level: conv.level,
    startedAt: result.startedAt,
    turns: result.turns.map(({ role, text, interrupted, echo }) => ({ role, text, interrupted, echo })),
    reportTurns: result.reportTurns,
    metrics: result.metrics.summary(null),
    report: null,
  };
  await saveSession(session);
  location.hash = `#/report/${session.id}`;
  requestReport(session, result.metrics);
}

async function requestReport(session, liveMetrics) {
  try {
    const res = await createReport(session.scenarioId, session.level, session.reportTurns);
    session.report = res.report;
    session.droppedUngrounded = res.dropped_ungrounded;
    session.reportError = null;
    // Recompute cost with the report call included.
    if (liveMetrics) session.metrics = liveMetrics.summary(res.usage);
    else session.metrics = { ...session.metrics, reportTokens: res.usage.prompt_tokens + res.usage.output_tokens };
  } catch (err) {
    session.reportError = err.message;
    if (err instanceof ApiError && err.status === 401) session.reportError = "Access code needed.";
  }
  await saveSession(session);
  if (location.hash === `#/report/${session.id}`) renderReport(session.id);
}

// ---------- report ----------

async function renderReport(id) {
  const s = await getSession(id);
  if (!s) return (location.hash = "#/history");
  const scenario = scenarioById(s.scenarioId);
  const r = s.report;

  let body;
  if (r) {
    body = `
      <div class="scores">
        ${score("Fluency", r.fluency_score)}${score("Accuracy", r.accuracy_score)}
      </div>
      <p class="summary">${esc(r.summary)}</p>
      ${section(
        "Grammar",
        r.grammar_mistakes,
        (m) => `<li><p class="was">${esc(m.original)}</p><p class="now">${esc(m.corrected)}</p><p class="why">${esc(m.explanation)}</p></li>`,
        "No grammar mistakes found. Nice!",
      )}
      ${section(
        "Sound more natural",
        r.natural_phrasing,
        (p) => `<li><p class="was plain">${esc(p.original)}</p><p class="now">${esc(p.suggestion)}</p></li>`,
        "Nothing to add here.",
      )}
      ${section(
        "Words to keep",
        r.vocabulary,
        (v) => `<li><p><strong>${esc(v.word)}</strong> · ${esc(v.meaning)}</p><p class="why">“${esc(v.example)}”</p></li>`,
        "No new words this time.",
      )}
      ${s.droppedUngrounded ? `<p class="muted small">${s.droppedUngrounded} suggestion(s) were removed because they didn't quote something you actually said.</p>` : ""}`;
  } else if (s.reportError) {
    body = `<p class="banner error">${esc(s.reportError)}</p><button class="btn primary" id="retry">Try the report again</button>`;
  } else {
    body = `<div class="loading"><span class="spinner"></span>Mario is writing your report…</div>`;
  }

  view.innerHTML = `
    <header class="page-head">
      <h1>${esc(scenario?.title ?? "Conversation")}</h1>
      <p class="muted">${fmtDate(s.startedAt)} · Level ${esc(s.level)} · ${fmtDuration(s.metrics.durationMs)}</p>
    </header>
    ${body}
    <details class="panel">
      <summary>Transcript</summary>
      <ol class="transcript static">
        ${s.turns.map((t) => `<li class="bubble ${t.role}${t.interrupted ? " cut" : ""}${t.echo ? " echo" : ""}">${esc(t.text)}</li>`).join("")}
      </ol>
    </details>
    <details class="panel">
      <summary>Speed and cost</summary>
      ${metricsList(s.metrics)}
    </details>
    <div class="row">
      <a class="btn primary" href="#/talk/${esc(s.scenarioId)}">Practice again</a>
      <button class="btn ghost" id="delete">Delete</button>
    </div>`;

  view.querySelector("#retry")?.addEventListener("click", () => {
    s.reportError = null;
    saveSession(s).then(() => {
      renderReport(id);
      requestReport(s, null);
    });
  });
  view.querySelector("#delete").addEventListener("click", async () => {
    if (!confirm("Delete this conversation?")) return;
    await deleteSession(id);
    location.hash = "#/history";
  });
}

function score(label, value) {
  return `<div class="score"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="15.9"/><circle class="fill" cx="18" cy="18" r="15.9" stroke-dasharray="${value} 100"/></svg><strong>${value}</strong><span>${label}</span></div>`;
}

function section(title, items, row, empty) {
  return `<section class="panel"><h2>${title}</h2>${items.length ? `<ul class="items">${items.map(row).join("")}</ul>` : `<p class="muted">${empty}</p>`}</section>`;
}

function metricsList(m) {
  const tokens = (o) => Object.entries(o ?? {}).map(([k, v]) => `${v.toLocaleString()} ${k.toLowerCase()}`).join(", ") || "–";
  return `<dl class="stats">
    <div><dt>Connect</dt><dd>${fmtMs(m.connectMs)}</dd></div>
    <div><dt>First voice reply</dt><dd>${fmtMs(m.firstAudioMs)}</dd></div>
    <div><dt>Median reply delay</dt><dd>${fmtMs(m.medianLatencyMs)}</dd></div>
    <div><dt>Interruptions</dt><dd>${m.bargeIns}</dd></div>
    <div><dt>Live tokens in</dt><dd>${tokens(m.liveTokens?.prompt)}</dd></div>
    <div><dt>Live tokens out</dt><dd>${tokens(m.liveTokens?.response)}</dd></div>
    <div><dt>Report tokens</dt><dd>${(m.reportTokens ?? 0).toLocaleString()}</dd></div>
    <div><dt>Est. cost (paid tier)</dt><dd>${fmtUsd(m.costUsd ?? 0)}</dd></div>
  </dl>`;
}

// ---------- history ----------

async function renderHistory() {
  const sessions = await listSessions();
  const scored = sessions.filter((s) => s.report).reverse();
  view.innerHTML = `
    <header class="page-head"><h1>History</h1></header>
    <section class="panel">
      <h2>Progress</h2>
      ${progressChart(scored.map((s) => ({ t: new Date(s.startedAt), fluency: s.report.fluency_score, accuracy: s.report.accuracy_score })))}
    </section>
    ${
      sessions.length
        ? `<ul class="history">${sessions
            .map(
              (s) => `<li><a href="#/report/${s.id}">
                <span><strong>${esc(scenarioById(s.scenarioId)?.title ?? s.scenarioId)}</strong><small>${fmtDate(s.startedAt)} · ${fmtDuration(s.metrics.durationMs)}</small></span>
                <span class="pill">${s.report ? `${s.report.fluency_score} / ${s.report.accuracy_score}` : "no report"}</span>
              </a></li>`,
            )
            .join("")}</ul>`
        : `<p class="muted center">No conversations yet. <a href="#/">Start one</a>.</p>`
    }`;
}

// ---------- metrics ----------

async function renderMetrics() {
  const sessions = await listSessions();
  const vals = (key) => sessions.map((s) => s.metrics?.[key]).filter((v) => typeof v === "number");
  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const allLatencies = sessions.flatMap((s) => s.metrics?.turnLatencies ?? []);
  const totalCost = vals("costUsd").reduce((a, b) => a + b, 0);
  const totalMin = vals("durationMs").reduce((a, b) => a + b, 0) / 60000;

  view.innerHTML = `
    <header class="page-head"><h1>Metrics</h1>
      <p class="muted">Measured on this device across ${sessions.length} conversation(s). Reply delay runs from the end of your speech to Mario's first audio.</p></header>
    <dl class="stats big">
      <div><dt>Median reply delay</dt><dd>${fmtMs(median(allLatencies))}</dd></div>
      <div><dt>Median first reply</dt><dd>${fmtMs(median(vals("firstAudioMs")))}</dd></div>
      <div><dt>Median connect</dt><dd>${fmtMs(median(vals("connectMs")))}</dd></div>
      <div><dt>Est. cost / minute</dt><dd>${totalMin ? fmtUsd(totalCost / totalMin) : "–"}</dd></div>
    </dl>
    <p class="muted small">Costs are what these conversations would cost on Gemini's paid tier. The free tier is $0.</p>
    ${
      sessions.length
        ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Length</th><th>First reply</th><th>Median delay</th><th>Tokens</th><th>Cost</th></tr></thead>
        <tbody>${sessions
          .map(
            (s) => `<tr><td><a href="#/report/${s.id}">${new Date(s.startedAt).toLocaleDateString()}</a></td>
            <td>${fmtDuration(s.metrics.durationMs)}</td><td>${fmtMs(s.metrics.firstAudioMs)}</td>
            <td>${fmtMs(s.metrics.medianLatencyMs)}</td>
            <td>${((s.metrics.liveTokens?.total ?? 0) + (s.metrics.reportTokens ?? 0)).toLocaleString()}</td>
            <td>${fmtUsd(s.metrics.costUsd ?? 0)}</td></tr>`,
          )
          .join("")}</tbody></table></div>`
        : ""
    }`;
}

// ---------- small UI helpers ----------

function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.role = "status";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function askAccessCode(retry) {
  const dlg = document.getElementById("code-dialog");
  const input = dlg.querySelector("input");
  input.value = accessCode.get();
  dlg.showModal();
  dlg.addEventListener(
    "close",
    () => {
      if (dlg.returnValue === "ok" && input.value.trim()) {
        accessCode.set(input.value.trim());
        retry();
      }
    },
    { once: true },
  );
}

// ---------- start-up ----------

window.addEventListener("hashchange", route);
window.addEventListener("online", route);
window.addEventListener("offline", () => !conversation && route());
window.addEventListener("pagehide", () => conversation?.end());

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
warmUp();
route();
