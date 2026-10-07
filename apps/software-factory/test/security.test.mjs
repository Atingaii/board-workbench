import assert from "node:assert/strict";
import { test } from "node:test";
import { security } from "../app/api/board/[[...path]]/security.ts";

function event() {
  return {
    index: 88,
    type: "reaction.added",
    actor: { id: "slack:user:U123", handle: "sam" },
    payload: {
      emoji: "security",
      from: "slack",
      by: { actor: "slack:user:U123", principal: "slack:user:U123" },
    },
    message: {
      id: 59,
      re: null,
      labels: { pr: "basehub-ai/vboard#53", state: "open" },
      by: { actor: "github:user:40034115", principal: "github:user:40034115" },
    },
  };
}

function harness() {
  const notifications = [];
  const replies = [];
  const reactions = [];
  const watcher = security({ tellPi: async input => { notifications.push(input); } });
  const board = {
    reply: async (id, text) => { replies.push({ id, text }); },
    react: async (id, emoji) => { reactions.push({ id, emoji }); },
  };
  return { notifications, replies, reactions, watcher, run: (input = event()) => watcher.run({ event: input, board }) };
}

test("tails dev, so a non-PR thread's reaction reaches it too", () => {
  assert.equal(harness().watcher.tail, "dev");
});

test(":security: on a PR root asks Pi for a deepsec review of the diff, for any Slack reactor", async () => {
  for (const user of ["U123", "U456"]) {
    const input = event();
    input.payload.by = { actor: `slack:user:${user}`, principal: `slack:user:${user}` };
    const h = harness();
    await h.run(input);
    assert.deepEqual(h.replies, []);
    assert.deepEqual(h.reactions, [], "only Pi reacts :secure:, after deepsec exits 0");
    assert.equal(h.notifications.length, 1);
    const n = h.notifications[0];
    assert.equal(n.task, "review");
    assert.equal(n.thread, 59);
    assert.equal(n.key, "security-88");
    assert.ok(n.message.includes(`(slack:user:${user}) reacted with :security:`));
    assert.ok(n.message.includes("basehub-ai/vboard#53"));
    assert.ok(n.message.includes("gh pr checkout 53"));
    assert.ok(n.message.includes("npm i -g @anthropic-ai/claude-code"));
    assert.ok(n.message.includes("timeout 30m env CLAUDE_CODE_EXECUTABLE=claude npx -y deepsec process --diff origin/<base> --comment-out deepsec.md"));
    assert.ok(n.message.includes("Exit 0"));
    assert.ok(n.message.includes("vb react 59 secure"));
    assert.ok(n.message.includes("Exit 1"));
    assert.ok(n.message.includes("don't react :secure:"));
    assert.ok(n.message.includes("Any other exit"));
  }
});

test("names the requester by handle, or by verified identity without one", async () => {
  const h = harness();
  await h.run();
  assert.ok(h.notifications[0].message.startsWith("sam (slack:user:U123)"));
  const input = event();
  delete input.actor;
  const g = harness();
  await g.run(input);
  assert.ok(g.notifications[0].message.startsWith("slack:user:U123 (slack:user:U123)"));
});

for (const [name, change] of [
  ["an unlabeled thread", e => { e.message.labels = { kind: "bug" }; }],
  ["a PR from another repository", e => { e.message.labels.pr = "other/repo#53"; }],
  ["a malformed PR label", e => { e.message.labels.pr = "basehub-ai/vboard#53/merge"; }],
]) {
  test(`on ${name}, replies that :security: works on PR threads without waking Pi`, async () => {
    const input = event();
    change(input);
    const h = harness();
    await h.run(input);
    assert.deepEqual(h.notifications, []);
    assert.equal(h.replies.length, 1);
    assert.equal(h.replies[0].id, 59);
    assert.ok(h.replies[0].text.includes("works on PR threads"));
  });
}

for (const [name, change] of [
  ["a reaction on a reply", e => { e.message.re = 12; }],
  ["a removed reaction", e => { e.type = "reaction.removed"; }],
  ["a different emoji", e => { e.payload.emoji = "shipit"; }],
  ["its own :secure: reaction", e => { e.payload.emoji = "secure"; }],
  ["a board reaction", e => { e.payload.from = null; }],
  ["a GitHub reaction", e => { e.payload.from = "github"; }],
  ["Pi or a deployment acting as a Slack reactor", e => { e.payload.by.principal = "vercel:project:pi:production"; }],
  ["a posted message", e => { e.type = "message.posted"; }],
  ["an event without a message", e => { delete e.message; }],
]) {
  test(`ignores ${name}`, async () => {
    const input = event();
    change(input);
    const h = harness();
    await h.run(input);
    assert.deepEqual(h.notifications, []);
    assert.deepEqual(h.replies, []);
    assert.deepEqual(h.reactions, []);
  });
}

test("a retried callback sends Pi the same deduplication key", async () => {
  const h = harness();
  await h.run();
  await h.run();
  assert.equal(h.notifications.length, 2);
  assert.deepEqual(h.notifications[0], h.notifications[1]);
});
