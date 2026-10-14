import assert from "node:assert/strict";
import { test } from "node:test";
import { factoryBoardStorePrefix, factoryBoardTrustedSources } from "../app/api/factory-board/[[...path]]/config.ts";
import { caller, deploymentToken, personToken, testBoard, TEAM_ID } from "../../../packages/vboard/test/harness.ts";

const URL = "http://board.test/api/factory-board";
const grants = JSON.stringify([{ projectId: "prj_factory", teamId: TEAM_ID }]);
const options = { url: URL, trustedSources: factoryBoardTrustedSources(grants) };
const token = (environment = "production", overrides) => deploymentToken("factory", "prj_factory", environment, { audience: URL, ...overrides });

test("requires explicit immutable project/team grants and defaults to production", () => {
  assert.deepEqual(factoryBoardTrustedSources(undefined), []);
  assert.deepEqual(factoryBoardTrustedSources(""), []);
  for (const grant of [
    { projectId: "factory", teamId: TEAM_ID },
    { projectId: "prj_factory" },
    { projectId: "prj_factory", teamId: TEAM_ID, environments: [] },
    { projectId: "prj_factory", teamId: TEAM_ID, can: ["sync"] },
  ]) assert.throws(() => factoryBoardTrustedSources(JSON.stringify([grant])));
  assert.throws(() => factoryBoardTrustedSources("not JSON"));
});

test("trusted Factory sessions discover, post, review and respond with verified provenance", async () => {
  const board = testBoard(options);
  const author = caller(board.fetch, await token(), { "x-board-profile": "factory", "x-board-session": "author-task-1" });
  const reviewer = caller(board.fetch, await token(), { "x-board-profile": "factory", "x-board-session": "review-task-2" });
  const channel = "factory/aaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbb/ci-health";
  const posted = await author("POST", "/messages", {
    channel, text: "Reproduced timeout: artifact://log-a", id: "factory-repro", noSync: true,
    labels: { "factory-task": "task-1", "factory-workflow": "ci" },
  });
  assert.equal(posted.status, 201);
  const root = posted.body.message;
  assert.equal(root.by.principal, "vercel:project:prj_factory:production");
  assert.equal(root.by.session, "author-task-1");
  assert.equal(root.channel, channel);
  const found = await reviewer("GET", `/messages?channel=${encodeURIComponent(channel)}&text=timeout&limit=1`);
  assert.equal(found.status, 200);
  assert.equal(found.body.messages[0].id, root.id);
  const review = await reviewer("POST", "/messages", { re: root.id, text: "Also fails before the patch: artifact://log-b", id: "factory-review", noSync: true });
  assert.equal(review.status, 201);
  const read = await author("GET", `/messages?channel=${encodeURIComponent(channel)}&re=${root.id}&after=${root.id}&limit=1`);
  assert.equal(read.body.messages[0].by.session, "review-task-2");
  const response = await author("POST", "/messages", { re: root.id, text: "Revised diagnosis: missing startup prerequisite.", id: "factory-response", noSync: true });
  assert.equal(response.status, 201);
  const replay = await author("POST", "/messages", { channel, text: root.text, labels: root.labels, id: "factory-repro", noSync: true });
  assert.equal(replay.status, 201);
  assert.equal(replay.body.message.id, root.id);
  assert.equal((await author("GET", "/channels")).body.channels[0].path, channel);
  assert.equal((await author("POST", `/messages/${root.id}/labels`, { set: { kind: "bug" } })).status, 403);
  assert.equal((await author("POST", `/messages/${root.id}/reactions`, { emoji: "eyes" })).status, 403);
});

test("refuses unconfigured projects, wrong teams, environments, audiences and malformed tokens", async () => {
  const board = testBoard(options);
  assert.equal((await caller(testBoard({ url: URL }).fetch, await token())("GET", "/me")).status, 403);
  for (const candidate of [
    await deploymentToken("other", "prj_other", "production", { audience: URL }),
    await token("production", { teamId: "team_other" }),
    await token("preview"),
    await token("development"),
  ]) assert.equal((await caller(board.fetch, candidate)("GET", "/me")).status, 403);
  assert.equal((await caller(board.fetch, await token("production", { audience: "http://board.test/api/board" }))("GET", "/me")).status, 401);
  assert.equal((await caller(board.fetch, "not-a-jwt")("GET", "/me")).status, 401);
});

test("board-project users can inspect while another board's token and history stay separate", async () => {
  const board = testBoard(options);
  const inspector = caller(board.fetch, await personToken("u_operator", URL));
  assert.equal((await inspector("GET", "/me")).body.kind, "person");
  assert.equal((await caller(board.fetch, await personToken())("GET", "/me")).status, 401);
  const softwareBoard = testBoard();
  const original = caller(softwareBoard.fetch, await personToken());
  await original("POST", "/messages", { channel: "dev", text: "Existing software factory work" });
  assert.deepEqual((await inspector("GET", "/messages")).body.messages, []);
});

test("explicit preview grants work and preview storage is separated by branch", async () => {
  const board = testBoard({ url: URL, trustedSources: factoryBoardTrustedSources(JSON.stringify([
    { projectId: "prj_factory", teamId: TEAM_ID, environments: ["preview"] },
  ])) });
  assert.equal((await caller(board.fetch, await token("preview"))("GET", "/me")).status, 200);
  assert.notEqual(factoryBoardStorePrefix("production"), "vboard-factory-2");
  assert.notEqual(factoryBoardStorePrefix("production"), factoryBoardStorePrefix("preview", "main"));
  assert.notEqual(factoryBoardStorePrefix("preview", "feature-a"), factoryBoardStorePrefix("preview", "feature-b"));
  assert.throws(() => factoryBoardStorePrefix("preview"));
});
