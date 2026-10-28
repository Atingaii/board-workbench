import assert from "node:assert/strict";
import { test } from "node:test";
import { devMirror, inThread, prThreadOf, sourceOfPr } from "../app/api/board/[[...path]]/inthread.ts";

const raw = (ref, repo = "vercel-labs/board") => ({ pull_request: { head: { ref, repo: { full_name: repo } } } });

test("a PR's source thread comes from a board/<thread> branch in this repo only", () => {
  assert.equal(sourceOfPr(raw("board/2036")), "2036");
  assert.equal(sourceOfPr(raw("board/2036-names")), "2036");
  assert.equal(sourceOfPr(raw("board/2036", "someone/fork")), null);
  assert.equal(sourceOfPr(raw("jb/branch")), null);
  assert.equal(sourceOfPr(raw("pi/2036")), null);
  assert.equal(sourceOfPr({}), null);
});

test("reactions act on a PR root or a factory PR's line, nothing else", () => {
  assert.equal(prThreadOf({ id: "9", re: null, labels: {} }), "9");
  assert.equal(prThreadOf({ id: "12", re: "5", labels: { pr: "vercel-labs/board#1", "pr.thread": "9" } }), "9");
  assert.equal(prThreadOf({ id: "12", re: "9", labels: {} }), null);
  assert.equal(prThreadOf(undefined), null);
});

test("dev's Slack mirror starts every new root but a factory PR's", async () => {
  const started = [];
  const out = (labels) => ({ direction: "out", channel: "C1", target: null, message: { re: null, channel: "dev", labels }, start: async (c) => { started.push([c, labels]); } });
  const sync = devMirror("dev");
  await sync(out({}));
  await sync(out({ pr: "vercel-labs/board#7" }));
  await sync(out({ pr: "vercel-labs/board#8", source: "2036" }));
  assert.deepEqual(started.map(([, labels]) => labels.pr ?? "plain"), ["plain", "vercel-labs/board#7"]);
});

const text = "PR #77: Post PRs in their thread\nhttps://github.com/vercel-labs/board/pull/77";
const root = (labels) => ({ id: "2400", re: null, deleted: false, text, labels: { pr: "vercel-labs/board#77", state: "draft", source: "2036", ...labels } });

/** `now` is the root as the board has it when the watcher reads it, which may be ahead of the event's. */
function harness(now) {
  const calls = [];
  const board = {
    thread: async () => ({ message: now }),
    reply: async (id, input) => { calls.push(["reply", id, input]); return { id: "3000" }; },
    label: async (id, change) => { calls.push(["label", id, change]); },
    react: async (id, emoji, opts) => { calls.push(["react", id, emoji, opts?.remove ? "remove" : "add"]); },
    edit: async (id, text) => { calls.push(["edit", id, text]); },
  };
  const has = (call) => calls.some((c) => JSON.stringify(c) === JSON.stringify(call));
  return { calls, has, run: (event) => inThread().run({ event, board }) };
}
const added = (h) => h.calls.filter((c) => c[0] === "react" && c[3] === "add").map((c) => c[2]);

test("a new factory PR posts its line in its source thread and puts its emoji on the root", async () => {
  const h = harness(root());
  await h.run({ type: "message.posted", message: root() });
  assert.ok(h.has(["reply", "2036", { text, labels: { pr: "vercel-labs/board#77", state: "draft", "pr.thread": "2400" }, id: "pr-card-2400" }]));
  assert.ok(h.has(["label", "2400", { set: { card: "3000" } }]));
  assert.deepEqual(added(h), ["pr-draft"]);
});

test("a PR marked ready before its line exists still gets a ready line and emoji", async () => {
  // The root was posted as a draft, then relabeled open before this watcher ran on the post.
  const h = harness(root({ state: "open" }));
  await h.run({ type: "message.posted", message: root() });
  assert.equal(h.calls.find((c) => c[0] === "reply")[2].labels.state, "open");
  assert.deepEqual(added(h), ["pr"]);
  // The state event that comes next, with the event's snapshot still missing the card, changes nothing more.
  const next = harness(root({ state: "open", card: "3000" }));
  await next.run({ type: "labels.changed", payload: { set: { state: "open" } }, message: root({ state: "open" }) });
  assert.ok(!next.calls.some((c) => c[0] === "reply"));
  assert.ok(next.has(["label", "3000", { set: { state: "open" } }]));
});

test("a state change relabels the line and swaps the root's emoji; a retitle edits it", async () => {
  const h = harness(root({ state: "merged", card: "3000" }));
  await h.run({ type: "labels.changed", payload: { set: { state: "merged" } }, message: root({ state: "merged", card: "3000" }) });
  assert.ok(h.has(["label", "3000", { set: { state: "merged" } }]));
  assert.deepEqual(added(h), ["pr-merged"]);
  for (const emoji of ["pr", "pr-draft", "pr-closed"]) assert.ok(h.has(["react", "2036", emoji, "remove"]));
  const retitled = { ...root({ card: "3000" }), text: "PR #77: A new title\nhttps://github.com/vercel-labs/board/pull/77" };
  const edited = harness(retitled);
  await edited.run({ type: "message.edited", message: root({ card: "3000" }) });
  assert.deepEqual(edited.calls, [["edit", "3000", retitled.text]]);
});

test("PRs without a source thread, replies, reactions, and other label changes do nothing", async () => {
  const h = harness(root({ card: "3000" }));
  await h.run({ type: "message.posted", message: root({ source: undefined }) });
  await h.run({ type: "message.posted", message: { ...root(), labels: { pr: "vercel-labs/board#77" } } });
  await h.run({ type: "message.posted", message: { ...root(), re: "2400" } });
  await h.run({ type: "reaction.added", message: root({ card: "3000" }) });
  await h.run({ type: "labels.changed", payload: { set: { card: "3000" } }, message: root({ card: "3000" }) });
  await h.run({ type: "labels.changed", payload: { set: { review: "approved" } }, message: root({ card: "3000" }) });
  assert.deepEqual(h.calls, []);
});
