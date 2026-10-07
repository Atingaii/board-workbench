import assert from "node:assert/strict";
import { test } from "node:test";
import { INSTRUCTIONS } from "../app/api/board/[[...path]]/agent.ts";

test("thread: Pi looks for related threads and PRs before it plans or builds", () => {
  assert.match(INSTRUCTIONS.thread, /vb read dev --text <keywords>/);
  assert.match(INSTRUCTIONS.thread, /gh pr list --state all --search <keywords>/);
  assert.match(INSTRUCTIONS.thread, /build on it/);
});
