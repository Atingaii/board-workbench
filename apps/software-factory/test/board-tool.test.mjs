import assert from "node:assert/strict";
import { test } from "node:test";
import { BOARD, eveName, eveSession, policy } from "../app/api/board/[[...path]]/harness.ts";
import { eveBoard, runBoard } from "../agent/lib/board-tool.ts";
import { caller, deploymentToken, personToken, PROJECT_ID, testBoard } from "../../../packages/board/test/harness.ts";

// The factory runs in production, so its own production deployment, Eve, has full access.
process.env.VERCEL_ENV = "production";

// The board tool against an in-process board, as the factory's own production deployment, the way
// Eve's token reaches it: only the transport is the test's.
async function setup(thread = "1419") {
  const board = testBoard({ url: BOARD });
  const token = await deploymentToken("vboard-factory", PROJECT_ID, "production", { audience: BOARD });
  const sent = [];
  const eve = eveBoard(thread, {
    token: async () => token,
    fetch: (input, init) => {
      const request = new Request(input, init);
      sent.push(request.headers);
      return board.fetch(request);
    },
  });
  const person = caller(board.fetch, await personToken("u_barba", BOARD));
  const root = (await person("POST", "/messages", { channel: "dev", text: "add a vb tool to eve", noSync: true })).body.message;
  return { board, eve, person, root, sent, token };
}

const noFiles = async () => null;

test("board tool: writes as the thread's Eve, with the headers vb gets from the network policy", async () => {
  const { eve, root, sent, token } = await setup();
  const id = await runBoard(eve, { action: "reply", target: `#${root.id}`, text: "on it" }, noFiles);
  const { replies } = await eve.thread(root.id);
  const reply = replies.find((m) => m.id === id);
  assert.equal(reply.text, "on it");
  assert.equal(reply.by.profile, eveName("1419"));
  assert.equal(reply.by.session, eveSession("1419"));
  assert.equal(reply.by.principal, `vercel:project:${PROJECT_ID}:production`);
  // The same headers the sandbox's policy adds to vb's requests.
  const [rule] = policy("1419", { gateway: "g", board: token, github: "h" }, undefined).allow[new URL(BOARD).host];
  for (const [name, value] of Object.entries(rule.transform[0].headers)) assert.equal(sent.at(-1).get(name), value);
});

test("board tool: read prints the thread as vb read does, and --json's messages", async () => {
  const { eve, root } = await setup();
  await runBoard(eve, { action: "reply", target: root.id, text: "first reply" }, noFiles);
  const text = await runBoard(eve, { action: "read", target: root.id }, noFiles);
  assert.match(text, new RegExp(`#${root.id}`));
  assert.match(text, /add a vb tool to eve/);
  assert.match(text, /↳ #\d+ +sunny-gecko-1419/);
  assert.match(text, /first reply/);
  const json = (await runBoard(eve, { action: "read", target: root.id, json: true }, noFiles)).split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(json.map((m) => m.text), ["add a vb tool to eve", "first reply"]);
});

test("board tool: read lists a channel's threads, filtered by text", async () => {
  const { eve, person } = await setup();
  await person("POST", "/messages", { channel: "dev", text: "something else", noSync: true });
  const text = await runBoard(eve, { action: "read", target: "dev", text: "vb tool" }, noFiles);
  assert.match(text, /^dev · 1 thread · cursor/);
  assert.match(text, /add a vb tool to eve/);
  assert.doesNotMatch(text, /something else/);
});

test("board tool: react, label, and typing", async () => {
  const { eve, root } = await setup();
  assert.equal(await runBoard(eve, { action: "react", target: root.id, emoji: "eyes" }, noFiles), "ok");
  assert.equal(await runBoard(eve, { action: "label", target: root.id, label: ["reproduced=yes"] }, noFiles), "ok");
  assert.equal(await runBoard(eve, { action: "typing", target: root.id, status: "Building it" }, noFiles), "ok");
  let { message } = await eve.thread(root.id);
  assert.equal(message.labels.reproduced, "yes");
  assert.ok(message.reactions.eyes);
  await runBoard(eve, { action: "react", target: root.id, emoji: "eyes", remove: true }, noFiles);
  await runBoard(eve, { action: "label", target: root.id, unset: ["reproduced"] }, noFiles);
  ({ message } = await eve.thread(root.id));
  assert.equal(message.labels.reproduced, undefined);
  assert.equal(message.reactions.eyes, undefined);
  await assert.rejects(runBoard(eve, { action: "label", target: root.id, label: ["nope"] }, noFiles), /key=value/);
  await assert.rejects(runBoard(eve, { action: "react", target: "dev", emoji: "eyes" }, noFiles), /message ID/);
});

test("board tool: reply attaches files read from the sandbox", async () => {
  const { eve, root } = await setup();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const files = { "/tmp/shot.png": png };
  const read = async (path) => files[path] ?? null;
  const id = await runBoard(eve, { action: "reply", target: root.id, text: "PR: #1", attach: ["/tmp/shot.png"] }, read);
  const reply = (await eve.thread(root.id)).replies.find((m) => m.id === id);
  assert.deepEqual(reply.attachments.map((a) => [a.name, a.size]), [["shot.png", png.byteLength]]);
  await assert.rejects(runBoard(eve, { action: "reply", target: root.id, text: "x", attach: ["/tmp/missing.png"] }, read), /no such file/);
  const big = async () => new Uint8Array(4 * 1024 * 1024 + 1);
  await assert.rejects(runBoard(eve, { action: "reply", target: root.id, text: "x", attach: ["/tmp/big.mp4"] }, big), /over 4 MB/);
});
