import assert from "node:assert/strict";
import { test } from "node:test";
import { boardOnly, issues, pulls, sourceThread, unseenPr } from "../app/api/board/[[...path]]/quiet.ts";

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

test("board replies stay off GitHub, in PR and issue threads alike", async () => {
  const delivered = [];
  const out = (where) => ({ direction: "out", deliver: async () => void delivered.push(where) });
  await pulls(out("pulls"));
  await issues(out("issues"));
  assert.deepEqual(delivered, []);
});

const opened = (ref, repo = "vercel-labs/board") => ({
  kind: "lifecycle", type: "pr.opened", thread: "github:vercel-labs/board:77", subthread: null,
  raw: { pull_request: { head: { ref, repo: { full_name: repo } } } },
});
const withThreads = (threads, prs = []) => ({
  ...boardWith(prs),
  thread: async (id) => {
    if (threads[id] instanceof Error) throw threads[id];
    if (!threads[id]) throw Object.assign(new Error("not found"), { status: 404 });
    return { message: { re: null, channel: "dev", noSync: false, deleted: false, labels: {}, ...threads[id] } };
  },
});

test("a new factory PR lives in its source thread when that thread is a live dev root on Slack", async () => {
  const board = withThreads({ 2036: {} });
  assert.equal(await sourceThread(opened("board/2036"), board, "dev"), "2036");
});

test("a factory PR keeps its own Slack thread when its source can't show it, or it already has a root", async () => {
  const threads = { 1: { noSync: true }, 2: { deleted: true }, 3: { channel: "factory/x" }, 4: { re: "9" }, 5: {}, 6: { labels: { pr: "vercel-labs/board#70", source: "5" } } };
  const board = withThreads(threads);
  for (const ref of ["board/1", "board/2", "board/3", "board/4", "board/6", "board/404"]) assert.equal(await sourceThread(opened(ref), board, "dev"), null, ref);
  assert.equal(await sourceThread(opened("board/5", "someone/fork"), board, "dev"), null);
  assert.equal(await sourceThread(opened("jb/branch"), board, "dev"), null);
  assert.equal(await sourceThread(comment("github:vercel-labs/board:77"), board, "dev"), null);
  // A PR whose root is already in the channel stays there: its later events don't move it.
  assert.equal(await sourceThread(opened("board/5"), withThreads(threads, ["vercel-labs/board#77"]), "dev"), null);
});

test("a source thread the board can't read right now fails the import, so it's retried", async () => {
  const board = withThreads({ 2036: new Error("board unavailable") });
  await assert.rejects(sourceThread(opened("board/2036"), board, "dev"), /board unavailable/);
});
