import assert from "node:assert/strict";
import { test } from "node:test";
import { shipit } from "../app/api/board/[[...path]]/shipit.ts";

function event() {
  return {
    type: "reaction.added",
    payload: {
      emoji: "shipit",
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

function harness(responses) {
  const requests = [];
  const replies = [];
  let tokens = 0;
  const watcher = shipit({
    token: async () => { tokens++; return "test-token"; },
    fetch: async (url, init) => {
      requests.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
      const response = responses.shift();
      assert.ok(response, "unexpected GitHub request");
      if (response instanceof Error) throw response;
      return Response.json(response.body, { status: response.status ?? 200 });
    },
  });
  return {
    requests,
    replies,
    tokens: () => tokens,
    run: (input = event()) => watcher.run({
      event: input,
      board: { reply: async (id, text) => { replies.push({ id, text }); } },
    }),
  };
}

const open = () => ({ body: { merged: false, state: "open", draft: false, head: { sha: "abc123" } } });
const merged = () => ({ body: { merged: true } });

test("any Slack reactor can merge a PR root, independently of its author", async () => {
  for (const user of ["U123", "U456"]) {
    const input = event();
    input.payload.by = { actor: `slack:user:${user}`, principal: `slack:user:${user}` };
    const h = harness([open(), merged()]);
    await h.run(input);
    assert.equal(h.tokens(), 1);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[0].url, "https://api.github.com/repos/basehub-ai/vboard/pulls/53");
    assert.equal(h.requests[0].method, "GET");
    assert.equal(h.requests[1].url, "https://api.github.com/repos/basehub-ai/vboard/pulls/53/merge");
    assert.equal(h.requests[1].method, "PUT");
    assert.deepEqual(h.requests[1].body, { sha: "abc123", merge_method: "merge" });
    for (const request of h.requests) {
      assert.equal(request.headers.authorization, "Bearer test-token");
      assert.equal(request.headers["x-github-api-version"], "2026-03-10");
      assert.ok(request.signal instanceof AbortSignal);
    }
    assert.deepEqual(h.replies, []);
  }
});

for (const [name, change] of [
  ["a reaction on a reply", e => { e.message.re = 12; }],
  ["a removed reaction", e => { e.type = "reaction.removed"; }],
  ["a different emoji", e => { e.payload.emoji = "merged"; }],
  ["a board reaction", e => { e.payload.from = null; }],
  ["a GitHub reaction", e => { e.payload.from = "github"; }],
  ["a deployment acting as a Slack reactor", e => { e.payload.by.principal = "vercel:project:pi:production"; }],
  ["a PR from another repository", e => { e.message.labels.pr = "other/repo#53"; }],
  ["a malformed PR label", e => { e.message.labels.pr = "basehub-ai/vboard#53/merge"; }],
  ["an unlabeled thread", e => { e.message.labels = {}; }],
  ["an event without a message", e => { delete e.message; }],
]) {
  test(`ignores ${name} without obtaining credentials or calling GitHub`, async () => {
    const input = event();
    change(input);
    const h = harness([]);
    await h.run(input);
    assert.equal(h.tokens(), 0);
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.replies, []);
  });
}

test("a retried callback sees the merged PR and does not merge it again", async () => {
  const h = harness([open(), merged(), merged()]);
  await h.run();
  await h.run();
  assert.equal(h.requests.filter(r => r.method === "PUT").length, 1);
  assert.deepEqual(h.replies, []);
});

for (const [name, body, reason] of [
  ["draft", { state: "open", draft: true }, "The PR is still a draft."],
  ["closed", { state: "closed", draft: false }, "The PR is closed."],
  ["missing head", { state: "open", draft: false }, "GitHub did not return the PR's head SHA."],
]) {
  test(`reports a ${name} PR without attempting to merge it`, async () => {
    const h = harness([{ body }]);
    await h.run();
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.replies, [{ id: 59, text: `Couldn't merge basehub-ai/vboard#53: ${reason}` }]);
  });
}

for (const [status, message] of [
  [403, "Required approvals are missing."],
  [405, "Required status checks have not passed."],
  [409, "Head branch was modified."],
]) {
  test(`reports GitHub's ${status} rejection without bypassing rules or retrying another SHA`, async () => {
    const h = harness([open(), { status, body: { message } }]);
    await h.run();
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.replies, [{ id: 59, text: `Couldn't merge basehub-ai/vboard#53: ${message}` }]);
  });
}

test("reports an unsuccessful merge response", async () => {
  const h = harness([open(), { body: { merged: false, message: "Merge conflict." } }]);
  await h.run();
  assert.deepEqual(h.replies, [{ id: 59, text: "Couldn't merge basehub-ai/vboard#53: Merge conflict." }]);
});

test("reports a connection failure in the thread", async () => {
  const h = harness([new Error("fetch failed")]);
  await h.run();
  assert.deepEqual(h.replies, [{ id: 59, text: "Couldn't merge basehub-ai/vboard#53: fetch failed" }]);
});
