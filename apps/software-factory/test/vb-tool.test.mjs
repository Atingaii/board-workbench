import assert from "node:assert/strict";
import { test } from "node:test";
import { BOARD, eveName, eveSession, policy } from "../app/api/board/[[...path]]/harness.ts";
import { eveBoard, runVb, SANDBOX_HOME } from "../agent/lib/vb-tool.ts";
import { caller, deploymentToken, personToken, PROJECT_ID, testBoard } from "../../../packages/board/test/harness.ts";

// The factory runs in production, so its own production deployment, Eve, has full access.
process.env.VERCEL_ENV = "production";

// The vb tool against an in-process board, as the factory's own production deployment, the way
// Eve's token reaches it: only the transport and the sandbox's files are the test's.
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
  const files = new Map();
  const sandbox = async () => ({
    readBinaryFile: async ({ path }) => files.get(path) ?? null,
    writeBinaryFile: async ({ path, content }) => void files.set(path, content),
  });
  const run = (...args) => runVb(eve, args, sandbox);
  return { eve, root, sent, token, files, run };
}

test("vb tool: writes as the thread's Eve, with the headers vb gets from the network policy", async () => {
  const { eve, root, sent, token, run } = await setup();
  const id = await run("reply", `#${root.id}`, "on it");
  const reply = (await eve.thread(root.id)).replies.find((m) => m.id === id);
  assert.equal(reply.text, "on it");
  assert.equal(reply.by.profile, eveName("1419"));
  assert.equal(reply.by.session, eveSession("1419"));
  assert.equal(reply.by.principal, `vercel:project:${PROJECT_ID}:production`);
  const [rule] = policy("1419", { gateway: "g", board: token, github: "h" }, undefined).allow[new URL(BOARD).host];
  for (const [name, value] of Object.entries(rule.transform[0].headers)) assert.equal(sent.at(-1).get(name), value);
});

test("vb tool: prints what vb prints, and says how a command failed", async () => {
  const { root, run } = await setup();
  await run("reply", root.id, "first reply");
  const text = await run("read", root.id);
  assert.match(text, /add a vb tool to eve/);
  assert.match(text, /↳ #\d+ +sunny-gecko-1419/);
  assert.match(text, /first reply/);
  assert.match(await run("read", "dev", "--text", "vb tool"), /^dev · 1 thread · cursor/);
  assert.equal(await run("read", "dve"), "error: no channel dve: board channels lists them\n(exit 1)");
  assert.equal(await run("label", root.id, "kind=bug"), "(no output)");
  assert.match(await run("whoami"), /isn't available in-process[\s\S]*\(exit 2\)$/);
});

test("vb tool: --attach and download use the sandbox's files, ~ and $HOME in its home", async () => {
  const { eve, root, files, run } = await setup();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  files.set(`${SANDBOX_HOME}/board/shot.png`, png);
  for (const path of ["~/board/shot.png", "$HOME/board/shot.png"]) {
    const id = await run("reply", root.id, "PR: #1", "--attach", path);
    assert.deepEqual((await eve.thread(root.id)).replies.find((m) => m.id === id).attachments.map((a) => [a.name, a.size]), [["shot.png", png.byteLength]]);
  }
  assert.match(await run("reply", root.id, "x", "--attach", "/tmp/missing.png"), /no such file: \/tmp\/missing\.png\n\(exit 2\)$/);
  const [attachment] = (await eve.thread(root.id)).replies.at(-1).attachments;
  assert.equal(await run("download", attachment.id, "~/copy.png"), "~/copy.png");
  assert.deepEqual(files.get(`${SANDBOX_HOME}/copy.png`), png);
});
