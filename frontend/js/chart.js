// A tiny dependency-free SVG line chart for score over time.

const W = 320;
const H = 140;
const PAD = { l: 28, r: 8, t: 10, b: 20 };

export function progressChart(points) {
  // points: [{ t: Date, fluency: number, accuracy: number }], oldest first
  if (points.length < 2) {
    return `<p class="muted">Finish two conversations to see your progress line.</p>`;
  }
  const x = (i) => PAD.l + (i * (W - PAD.l - PAD.r)) / (points.length - 1);
  const y = (v) => PAD.t + ((100 - v) * (H - PAD.t - PAD.b)) / 100;
  const line = (key) => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  const dots = (key, cls) =>
    points
      .map((p, i) => `<circle class="${cls}" cx="${x(i).toFixed(1)}" cy="${y(p[key]).toFixed(1)}" r="3"><title>${p[key]}</title></circle>`)
      .join("");
  const grid = [0, 50, 100]
    .map((v) => `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${PAD.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`)
    .join("");
  const fmt = (d) => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });

  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fluency and accuracy scores over time">
      ${grid}
      <path class="series fluency" d="${line("fluency")}"/>
      <path class="series accuracy" d="${line("accuracy")}"/>
      ${dots("fluency", "dot fluency")}${dots("accuracy", "dot accuracy")}
      <text class="axis" x="${PAD.l}" y="${H - 4}">${fmt(points[0].t)}</text>
      <text class="axis" x="${W - PAD.r}" y="${H - 4}" text-anchor="end">${fmt(points.at(-1).t)}</text>
    </svg>
    <div class="legend"><span class="key fluency"></span>Fluency <span class="key accuracy"></span>Accuracy</div>`;
}
