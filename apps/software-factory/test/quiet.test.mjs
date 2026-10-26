import assert from "node:assert/strict";
import { test } from "node:test";
import { boardOnly, fromBoard, unseenPr } from "../app/api/board/[[...path]]/quiet.ts";

const lifecycle = (type, labels = {}) => ({ subthread: null, type, labels });

test("a PR closed without merging stays off Slack", () => {
  assert.equal(boardOnly(lifecycle("pr.closed", { state: "closed" })), true);
});

test("merges, reopens and other PR events still reach Slack", () => {
  assert.equal(boardOnly(lifecycle("pr.closed", { state: "merged" })), false);
  assert.equal(boardOnly(lifecycle("pr.reopened", { state: "open" })), false);
  assert.equal(boardOnly(lifecycle("review.submitted", { review: "approved" })), false);
  assert.equal(boardOnly({ subthread: null, type: "comment" }), false);
});

test("inline review comments stay off Slack", () => {
  assert.equal(boardOnly({ subthread: "github:vercel-labs/board:40:rc:9", type: "comment" }), true);
});

const comment = (thread, subthread = null) => ({ kind: "message", type: "comment", thread, subthread });
const boardWith = (prs) => {
  const queries = [];
  return {
    queries,
    messages: async (query) => {
      queries.push(query);
      return { messages: prs.includes(query.label.pr) ? [{ id: "1" }] : [] };
    },
  };
};

test("a comment on a PR the board has no thread for stays on GitHub", async () => {
  const board = boardWith(["vercel-labs/board#180"]);
  assert.equal(await unseenPr(comment("github:vercel-labs/board:114"), board, "dev"), true);
  assert.equal(await unseenPr(comment("github:vercel-labs/board:114", "github:vercel-labs/board:114:rc:9"), board, "dev"), true);
  assert.deepEqual(board.queries[0], { channel: "dev", label: { pr: "vercel-labs/board#114" }, limit: 1 });
});

test("comments on known PRs, and PR events, still sync", async () => {
  const board = boardWith(["vercel-labs/board#180"]);
  assert.equal(await unseenPr(comment("github:vercel-labs/board:180"), board, "dev"), false);
  assert.equal(await unseenPr({ kind: "lifecycle", type: "pr.opened", thread: "github:vercel-labs/board:181", subthread: null }, board, "dev"), false);
  assert.equal(board.queries.length, 1);
});

test("GitHub gets what was written on the board, and reactions made there, not Slack's", async () => {
  const delivered = [];
  const out = (type, from, payloadFrom) => ({
    event: { type, payload: { from: payloadFrom } },
    message: { from },
    deliver: async () => void delivered.push(`${type}:${from}:${payloadFrom}`),
  });
  await fromBoard(out("message.posted", null, null));
  await fromBoard(out("message.posted", "slack", "slack"));
  // A Slack user's reaction on a board-written comment stays off GitHub, and a board reaction on a Slack message goes.
  await fromBoard(out("reaction.added", null, "slack"));
  await fromBoard(out("reaction.added", "slack", null));
  assert.deepEqual(delivered, ["message.posted:null:null", "reaction.added:slack:null"]);
});
