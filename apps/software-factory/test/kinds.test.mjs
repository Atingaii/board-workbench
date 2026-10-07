import assert from "node:assert/strict";
import { test } from "node:test";
import { CRITERIA, isPiKind, PI_KINDS, piTask } from "../app/api/board/[[...path]]/kinds.ts";

test("a request for Pi to do something is its own kind, and it goes to Pi", () => {
  // Board #1550: "i'll need a recap" fit none of bug/feature/question, so triage called it noise.
  assert.ok(CRITERIA.task, "the classifier can pick task");
  assert.ok(isPiKind("task"));
  assert.match(piTask("task"), /task/);
});

test("every kind Pi acts on is one the classifier can pick, and noise isn't one", () => {
  assert.deepEqual(PI_KINDS, ["bug", "feature", "question", "task"]);
  for (const kind of PI_KINDS) assert.ok(CRITERIA[kind], kind);
  assert.ok(CRITERIA.noise);
  assert.equal(isPiKind("noise"), false);
  assert.equal(isPiKind("toString"), false);
});
