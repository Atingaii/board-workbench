import assert from "node:assert/strict";
import { test } from "node:test";
import { byAgent, byPi, byWatcher, piAvatar, piName, sourceLink, startOrSay, taskMessage } from "../app/api/board/[[...path]]/agent.ts";

// Pi posts as the factory's production deployment.
process.env.VERCEL_PROJECT_ID = "prj_factory";

test("sourceLink: a Slack thread's permalink, a GitHub issue or PR, or nothing", () => {
  assert.deepEqual(sourceLink({ thread: "slack:C0C6MNT9LLC:1791394851.272189" }), {
    platform: "Slack",
    url: "https://vercel.slack.com/archives/C0C6MNT9LLC/p1791394851272189",
  });
  assert.deepEqual(sourceLink({ thread: "github:vercel-labs/board:issue:42" }), {
    platform: "GitHub",
    url: "https://github.com/vercel-labs/board/issues/42",
  });
  assert.deepEqual(sourceLink({ thread: "github:vercel-labs/board:78" }), {
    platform: "GitHub",
    url: "https://github.com/vercel-labs/board/pull/78",
  });
  assert.equal(sourceLink(null), null);
  assert.equal(sourceLink({ thread: "whatsapp:123" }), null);
});

test("taskMessage: Pi's task names where the thread came from and who posted it", () => {
  assert.equal(
    taskMessage("a feature request", {
      id: "1010",
      origin: { thread: "slack:C0C6MNT9LLC:1791394851.272189" },
      author: { name: "Martin Sione" },
    }),
    "There's a feature request in board thread #1010, posted by Martin Sione on Slack: https://vercel.slack.com/archives/C0C6MNT9LLC/p1791394851272189.",
  );
  assert.equal(
    taskMessage("a bug report", { id: "7", origin: null, author: null }),
    "There's a bug report in board thread #7.",
  );
});

test("piName: each thread's Pi has a name of its own", () => {
  assert.equal(piName("1956"), "clever-lemur-1956");
  const names = new Set();
  for (let t = 1; t <= 100_000; t++) {
    const name = piName(t);
    // A valid board profile: starts with a letter, up to 32 letters, numbers, and hyphens.
    if (t % 997 === 0) assert.match(name, /^[A-Za-z][A-Za-z0-9-]{0,31}$/);
    names.add(name);
  }
  assert.equal(names.size, 100_000);
  assert.ok(piName("99999999").length <= 32);
});

test("byPi: the thread's own Pi, by its name or the old `pi`, and no other thread's", () => {
  const session = "thread-1956";
  const principal = "vercel:project:prj_factory:production";
  assert.ok(byPi("1956", { principal, profile: piName("1956"), session }));
  assert.ok(byPi("1956", { principal, profile: "pi", session }));
  assert.ok(!byPi("1956", { principal, profile: piName("1957"), session }));
  assert.ok(!byPi("1956", { principal, profile: piName("1956"), session: "thread-1957" }));
  assert.ok(!byPi("1956", { principal, profile: null, session: null }));
});

test("byPi: only the factory's production deployment, since anyone who can write sends a profile and session", () => {
  const pi = { profile: piName("1956"), session: "thread-1956" };
  for (const principal of [
    "vercel:user:abc123",
    "vercel:project:prj_factory:preview",
    "vercel:project:prj_other:production",
    "github:repo:1",
    "slack:user:U1",
  ]) {
    assert.ok(!byPi("1956", { principal, ...pi }), principal);
  }
  delete process.env.VERCEL_PROJECT_ID;
  try {
    assert.ok(!byPi("1956", { principal: "vercel:project:undefined:production", ...pi }), "no project, no Pi");
  } finally {
    process.env.VERCEL_PROJECT_ID = "prj_factory";
  }
});

test("piAvatar: a PNG generated from each Pi's name", () => {
  assert.equal(piAvatar("1956"), "https://vercel.com/api/www/avatar?s=64&format=png&u=clever-lemur-1956");
});

test("byWatcher: the board's watchers' own notes, which wake neither Pi nor triage", () => {
  assert.ok(byWatcher({ actor: "board:watch:crosspost" }));
  assert.ok(byWatcher({ actor: "board:watch:security" }));
  assert.ok(byWatcher({ actor: "board:watch:pi" }));
  assert.ok(!byWatcher({ actor: "slack:user:U123" }));
  assert.ok(!byWatcher({ actor: "board:schedule" }));
});

test("byAgent: a coding agent's or Pi's message, which triage doesn't judge, and not a person's", () => {
  assert.ok(byAgent({ profile: "claude" }));
  assert.ok(byAgent({ profile: piName("1956") }));
  assert.ok(!byAgent({ profile: null }));
});

function thread() {
  const replies = [];
  return { replies, board: { reply: async (id, text) => { replies.push({ id, text }); } } };
}

test("startOrSay: a start that fails is tried again, and once Pi starts the thread hears nothing", async () => {
  const { replies, board } = thread();
  let tries = 0;
  await startOrSay(board, 7, async () => {
    if (++tries < 3) throw new Error("sandbox setup failed: ");
  }, 0);
  assert.equal(tries, 3);
  assert.deepEqual(replies, []);
});

test("startOrSay: a Pi that never starts says why in its thread instead of throwing, so its watcher keeps listening", async () => {
  const { replies, board } = thread();
  let tries = 0;
  const error = console.error;
  console.error = () => {};
  try {
    await startOrSay(board, 2903, async () => {
      tries++;
      throw new Error("sandbox setup failed: curl: (22) The requested URL returned error: 403\ncurl: (22) The requested URL returned error: 404");
    }, 0);
  } finally {
    console.error = error;
  }
  assert.ok(tries > 1, "it was retried first");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, 2903);
  assert.match(replies[0].text, /couldn't start/);
  assert.match(replies[0].text, /returned error: 403/);
  assert.match(replies[0].text, /try again/);
});

test("the reviewer tells the PR's source thread, and that thread's Pi acts on it", async () => {
  const { INSTRUCTIONS } = await import("../app/api/board/[[...path]]/agent.ts");
  assert.match(INSTRUCTIONS.review, /Tell the thread the work started in/);
  assert.match(INSTRUCTIONS.review, /board #<id>/);
  assert.match(INSTRUCTIONS.thread, /Your PR's reviewer posts its verdict in your thread/);
  assert.match(INSTRUCTIONS.thread, /gets the reviewer to look again/);
});

test("Pi's branch for a thread is board/<thread id>", async () => {
  const { INSTRUCTIONS } = await import("../app/api/board/[[...path]]/agent.ts");
  assert.match(INSTRUCTIONS.thread, /a branch named board\/<thread id>/);
  assert.match(INSTRUCTIONS.review, /its branch is board\/<id>/);
  for (const text of Object.values(INSTRUCTIONS)) assert.doesNotMatch(text, /\b(?:pi|factory)\/</);
});
