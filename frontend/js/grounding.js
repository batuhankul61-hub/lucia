// Report validation and grounding for bring-your-own-key mode.
// Mirrors Report and ground_report() in backend/app/report_schema.py: the
// report may only quote what the learner actually said.

const LIMITS = { grammar_mistakes: 15, natural_phrasing: 10, vocabulary: 10 };
const ITEM_FIELDS = {
  grammar_mistakes: ["original", "corrected", "explanation"],
  natural_phrasing: ["original", "suggestion"],
  vocabulary: ["word", "meaning", "example"],
};

/** Lowercase and strip punctuation, like report_schema.normalize(). */
export function normalize(text) {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}_']+/gu, " ").trim().split(/\s+/).filter(Boolean).join(" ");
}

/** Throws if the model's output doesn't match the report schema. */
export function validateReport(r) {
  const fail = (why) => {
    throw new Error(`Invalid report: ${why}`);
  };
  if (!r || typeof r !== "object") fail("not an object");
  for (const [key, fields] of Object.entries(ITEM_FIELDS)) {
    if (!Array.isArray(r[key])) fail(`${key} is not a list`);
    if (r[key].length > LIMITS[key]) fail(`${key} has too many items`);
    for (const item of r[key]) {
      if (!fields.every((f) => typeof item?.[f] === "string")) fail(`${key} item is missing a field`);
    }
  }
  for (const key of ["fluency_score", "accuracy_score"]) {
    if (!Number.isInteger(r[key]) || r[key] < 0 || r[key] > 100) fail(`${key} must be 0-100`);
  }
  if (typeof r.summary !== "string") fail("summary is missing");
  return r;
}

/** Keeps only items whose quoted "original" appears in the learner's turns. */
export function groundReport(report, turns) {
  const userText = turns.filter((t) => t.role === "user").map((t) => normalize(t.text)).join(" | ");
  const allText = turns.map((t) => normalize(t.text)).join(" | ");
  const said = (quote) => {
    const q = normalize(quote);
    return q !== "" && userText.includes(q);
  };

  const grammar = report.grammar_mistakes.filter((m) => said(m.original));
  const phrasing = report.natural_phrasing.filter((p) => said(p.original));
  const suggestions = [...grammar.map((m) => m.corrected), ...phrasing.map((p) => p.suggestion)].map(normalize).join(" | ");
  const vocab = report.vocabulary.filter((v) => {
    const w = normalize(v.word);
    return w !== "" && (allText.includes(w) || suggestions.includes(w));
  });

  const dropped =
    report.grammar_mistakes.length - grammar.length +
    report.natural_phrasing.length - phrasing.length +
    report.vocabulary.length - vocab.length;
  return { report: { ...report, grammar_mistakes: grammar, natural_phrasing: phrasing, vocabulary: vocab }, dropped };
}
