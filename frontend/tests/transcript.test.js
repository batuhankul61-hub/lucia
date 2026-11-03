import assert from "node:assert/strict";
import { test } from "node:test";

import { Transcript } from "../js/transcript.js";

test("late learner transcription lands before the tutor's reply", () => {
  const t = new Transcript(() => {});
  t.addTutor("What would you like?", 0);
  t.completeTurn(false, 1);
  t.addTutor("Sure, a latte!", 2); // tutor answers before the learner's text arrives
  t.addUser("A latte, please.", 3);
  t.completeTurn(false, 4);
  assert.deepEqual(t.turns.map((x) => x.role), ["tutor", "user", "tutor"]);
});

test("speaker echo of the tutor is flagged and left out of the report", () => {
  const t = new Transcript(() => {});
  t.addTutor("Would you like that for here or to go?", 0);
  t.completeTurn(true, 100);
  t.addUser("would you like that for here or to go", 1000);
  t.completeTurn(true, 1100);
  assert.equal(t.turns[1].echo, true);
  assert.deepEqual(t.forReport().map((x) => x.role), ["tutor"]);
});

test("short real replies are never treated as echo", () => {
  const t = new Transcript(() => {});
  t.addTutor("Is that okay?", 0);
  t.completeTurn(true, 100);
  t.addUser("yes okay", 500);
  t.completeTurn(true, 600);
  assert.equal(t.turns[1].echo, undefined);
});
