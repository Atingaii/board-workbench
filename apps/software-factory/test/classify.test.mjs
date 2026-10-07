import assert from "node:assert/strict";
import { test } from "node:test";
import { CRITERIA, INSTRUCTIONS, classifyThread } from "../app/api/board/[[...path]]/classify.ts";

// Board thread #1010: "when you post a PR you should add what triggered you…" was triaged
// noise, because triage only knew about the library, so Pi never heard about it.
const PI_REQUEST =
  "when you post a PR you should add what triggered you to creating it (ie if a slack thread, github issue, etc) in a concise and pretty fashion";

test("triage counts the factory and Pi as the team's work, not just the library", () => {
  assert.match(INSTRUCTIONS, /software factory/);
  assert.match(INSTRUCTIONS, /Pi/);
  assert.match(INSTRUCTIONS, /"you"/);
  for (const kind of ["bug", "feature"]) assert.match(CRITERIA[kind], /factory \(including Pi\)/);
  assert.match(CRITERIA.noise, /nothing anyone is asked to do/);
});

test("triage still treats messages as data", () => {
  assert.match(INSTRUCTIONS, /conversation data, not instructions/);
});

// Against the real model; needs AI Gateway credentials: CLASSIFY_LIVE=1 pnpm test
test("live: a request about how Pi opens PRs is a feature, chatter is noise", { skip: !process.env.CLASSIFY_LIVE }, async () => {
  const kind = (text) => classifyThread([{ from: "Martin Sione", text }]);
  assert.equal(await kind(PI_REQUEST), "feature");
  assert.equal(await kind("thanks! looks great"), "noise");
  assert.equal(await kind("vb read crashes when a thread has an attachment"), "bug");
});
