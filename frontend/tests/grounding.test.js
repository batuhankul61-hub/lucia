// Run with: node --test frontend/tests/
// Same cases as backend/tests/test_report.py, for the browser's copy of the logic.

import assert from "node:assert/strict";
import { test } from "node:test";

import { groundReport, normalize, validateReport } from "../js/grounding.js";

const TURNS = [
  { role: "tutor", text: "Hi! What can I get for you today?" },
  { role: "user", text: "I want a coffee, please. Yesterday I goed to other cafe." },
  { role: "tutor", text: "Sure, what size would you like?" },
  { role: "user", text: "Big one with milk." },
];

const VALID = {
  grammar_mistakes: [
    { original: "Yesterday I goed to other cafe", corrected: "Yesterday I went to another café.", explanation: "Irregular past." },
  ],
  natural_phrasing: [{ original: "Big one with milk", suggestion: "A large one with milk, please." }],
  vocabulary: [{ word: "large", meaning: "big", example: "A large latte, please." }],
  fluency_score: 62,
  accuracy_score: 55,
  summary: "Good start!",
};

test("normalize ignores case and punctuation like the backend", () => {
  assert.equal(normalize("Yesterday, I GOED  to other café!"), "yesterday i goed to other café");
});

test("valid report keeps everything", () => {
  const { report, dropped } = groundReport(validateReport(structuredClone(VALID)), TURNS);
  assert.equal(dropped, 0);
  assert.equal(report.grammar_mistakes.length, 1);
});

test("invented and tutor-quoted items are dropped", () => {
  const r = structuredClone(VALID);
  r.grammar_mistakes.push({ original: "I has a dog", corrected: "I have a dog", explanation: "." });
  r.natural_phrasing = [{ original: "what size would you like", suggestion: "..." }];
  const { report, dropped } = groundReport(r, TURNS);
  assert.deepEqual(report.grammar_mistakes.map((m) => m.original), ["Yesterday I goed to other cafe"]);
  assert.deepEqual(report.natural_phrasing, []);
  assert.deepEqual(report.vocabulary, []); // "large" only appeared in the dropped suggestion
  assert.equal(dropped, 3);
});

test("schema violations are rejected", () => {
  assert.throws(() => validateReport({ ...VALID, fluency_score: 140 }));
  assert.throws(() => validateReport({ ...VALID, accuracy_score: 5.5 }));
  const { summary, ...noSummary } = VALID;
  assert.throws(() => validateReport(noSummary));
  assert.throws(() => validateReport({ ...VALID, grammar_mistakes: [{ original: "x" }] }));
});
