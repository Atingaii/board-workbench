import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { eveHarness, memory, tellEve } from "../app/api/board/[[...path]]/eve.ts";
import { evePolicy, piName, policy } from "../app/api/board/[[...path]]/harness.ts";
import { boardFrom, boardOf } from "../agent/lib/board.ts";
import { script } from "../agent/lib/computer.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

/** eve's sessions API as the factory sees it: sessions it made, what each was sent, and ones that are gone. */
function fakeEve() {
  const made = [];
  const sent = [];
  const resets = [];
  const gone = new Set();
  return {
    made,
    sent,
    resets,
    gone,
    create: async () => {
      const id = `wrun_${made.length + 1}`;
      made.push(id);
      return id;
    },
    send: async (session, message, context) => {
      if (gone.has(session)) throw Object.assign(new Error("not active"), { name: "SessionNotActiveError" });
      sent.push({ session, message, context });
    },
    reset: async (session) => void resets.push(session),
  };
}

test("eveHarness: threads from FACTORY_EVE_FROM on go to eve; earlier ones, and all without it, stay with Pi", () => {
  assert.equal(eveHarness("900", "900"), true);
  assert.equal(eveHarness("901", "900"), true);
  assert.equal(eveHarness("899", "900"), false);
  assert.equal(eveHarness("900", undefined), false);
  assert.equal(eveHarness("900", ""), false);
  assert.equal(eveHarness("900", "soon"), false);
  assert.equal(eveHarness("abc", "1"), false);
});

test("tellEve: a thread's first message makes its session, later ones go to the same one, with the thread they're about", async () => {
  const sessions = memory(new Map());
  const eve = fakeEve();
  await tellEve({ task: "thread", thread: "900", key: "kind-bug", message: "There's a bug report in board thread #900." }, { sessions, eve });
  await tellEve({ task: "thread", thread: "900", key: "news-901", message: "There's new activity in board thread #900." }, { sessions, eve });
  await tellEve({ task: "review", thread: "900", key: "pr", message: "There's a pull request to review in board thread #900." }, { sessions, eve });
  assert.deepEqual(eve.made, ["wrun_1", "wrun_2"]);
  assert.deepEqual(
    eve.sent.map((s) => [s.session, s.context]),
    [
      ["wrun_1", { board: { task: "thread", thread: "900" } }],
      ["wrun_1", { board: { task: "thread", thread: "900" } }],
      ["wrun_2", { board: { task: "review", thread: "900" } }],
    ],
  );
});

test("tellEve: a message is delivered once, so a retried watcher is a no-op", async () => {
  const sessions = memory(new Map());
  const eve = fakeEve();
  const message = { task: "thread", thread: "900", key: "news-901", message: "There's new activity in board thread #900." };
  await tellEve(message, { sessions, eve });
  await tellEve(message, { sessions, eve });
  assert.equal(eve.sent.length, 1);
});

test("tellEve: two first messages racing leave one session for the thread, and reset the other", async () => {
  const sessions = memory(new Map());
  const eve = fakeEve();
  await Promise.all([
    tellEve({ task: "thread", thread: "900", key: "kind-bug", message: "a" }, { sessions, eve }),
    tellEve({ task: "thread", thread: "900", key: "news-901", message: "b" }, { sessions, eve }),
  ]);
  assert.equal(eve.made.length, 2);
  assert.equal(new Set(eve.sent.map((s) => s.session)).size, 1);
  assert.deepEqual(eve.resets, eve.made.filter((id) => id !== eve.sent[0].session));
});

test("tellEve: a session that's gone (idle too long, or reset) is replaced, and the message still arrives", async () => {
  const sessions = memory(new Map());
  const eve = fakeEve();
  await tellEve({ task: "thread", thread: "900", key: "kind-bug", message: "a" }, { sessions, eve });
  eve.gone.add("wrun_1");
  await tellEve({ task: "thread", thread: "900", key: "news-901", message: "b" }, { sessions, eve });
  await tellEve({ task: "thread", thread: "900", key: "news-902", message: "c" }, { sessions, eve });
  assert.deepEqual(eve.sent.map((s) => [s.session, s.message]), [["wrun_1", "a"], ["wrun_2", "b"], ["wrun_2", "c"]]);
});

test("tellEve: a message that couldn't be sent is sent by the next try", async () => {
  const sessions = memory(new Map());
  const eve = fakeEve();
  const send = eve.send;
  eve.send = async () => {
    throw new Error("eve is down");
  };
  const message = { task: "thread", thread: "900", key: "kind-bug", message: "a" };
  await assert.rejects(tellEve(message, { sessions, eve }), /eve is down/);
  eve.send = send;
  await tellEve(message, { sessions, eve });
  assert.deepEqual(eve.sent.map((s) => s.message), ["a"]);
});

test("boardFrom and boardOf: a session knows its thread from the turn's auth, or its first turn's, and nothing malformed", () => {
  assert.deepEqual(boardFrom({ board: { task: "review", thread: "900" } }), { task: "review", thread: "900" });
  assert.equal(boardFrom({ board: { task: "merge", thread: "900" } }), null);
  assert.equal(boardFrom({ board: { task: "thread", thread: "9 00; rm -rf" } }), null);
  assert.equal(boardFrom("thread 900"), null);
  assert.equal(boardFrom(undefined), null);
  const auth = (attributes) => ({ attributes, authenticator: "vercel-oidc", principalId: "p", principalType: "service" });
  assert.deepEqual(
    boardOf({ auth: { current: auth({ boardTask: "thread", boardThread: "901" }), initiator: auth({}) } }),
    { task: "thread", thread: "901" },
  );
  assert.deepEqual(
    boardOf({ auth: { current: null, initiator: auth({ boardTask: "thread", boardThread: "900" }) } }),
    { task: "thread", thread: "900" },
  );
  assert.equal(boardOf({ auth: { current: auth({}), initiator: null } }), null);
});

test("evePolicy: Pi's credentials and identity, plus git to github.com as the factory GitHub App", () => {
  const tokens = { gateway: "g", board: "b", github: "h" };
  const eve = evePolicy("900", tokens, "bypass");
  const pi = policy("900", tokens, "bypass");
  const { "github.com": git, ...rest } = eve.allow;
  assert.deepEqual(rest, pi.allow);
  assert.deepEqual(git, [
    { transform: [{ headers: { authorization: `Basic ${Buffer.from("x-access-token:h").toString("base64")}` } }] },
  ]);
  // Everything else stays reachable without credentials, and last, as in Pi's.
  assert.equal(Object.keys(eve.allow).at(-1), "*");
  const board = eve.allow["vboard-factory.playground-vercel.tools"][0].transform[0].headers;
  assert.equal(board["x-board-profile"], piName("900"));
});

test("computer: each call starts the desktop if it's down, then acts and screenshots, with text reaching the shell as data", () => {
  const typed = script({ title: "Typing", action: "type", text: "it's $(rm -rf ~)" });
  assert.match(typed, /Xvfb :99/);
  assert.ok(typed.includes(`'type' 'it'\\''s $(rm -rf ~)'`));
  assert.match(typed, /x11grab.*\/tmp\/computer\.png$/);
  assert.match(script({ title: "Clicking", action: "double_click", x: 10.4, y: 20.6 }), /'click' '10' '21' '1' '2'/);
  assert.throws(() => script({ title: "Clicking", action: "click" }), /click needs x/);
  assert.throws(() => script({ title: "Opening", action: "open" }), /open needs url or command/);
  assert.ok(script({ title: "Caption 'quoted'", action: "screenshot" }).includes(`step 'Caption '\\''quoted'\\'''`));
});

test("the eve agent compiles: Pi's model, skills and computer, eve's bash and files, its hook, and no subagents", async () => {
  const { stdout } = await promisify(execFile)("pnpm", ["exec", "eve", "info", "--json"], { cwd: root, maxBuffer: 64 << 20 });
  const info = JSON.parse(stdout);
  assert.equal(info.status, "ready");
  assert.equal(info.diagnostics.errors, 0);
  assert.equal(info.model, "anthropic/claude-opus-5.5");
  assert.deepEqual(info.skills, ["pr-description", "sitrep", "ui-video", "verify-board"]);
  assert.ok(info.tools.includes("bash") && info.tools.includes("computer") && info.tools.includes("read_file"));
  assert.ok(!info.tools.includes("agent"));
});
