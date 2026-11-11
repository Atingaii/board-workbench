import assert from "node:assert/strict";
import { test } from "node:test";
import { attributes, boardFrom, boardOf, sameDeployment } from "../agent/lib/board.ts";

// What the board's watcher sends with a message reaches the turn as the channel keeps it in auth,
// where the credentials read the thread's GitHub access.

const turn = (context: unknown) => {
  const board = boardFrom(context);
  const auth = board ? { attributes: attributes(board) } : null;
  return boardOf({ auth: { current: auth, initiator: null } });
};

test("the thread, the GitHub connector, and the repos reach the turn", () => {
  assert.deepEqual(turn({ board: { thread: "12", github: "github/factory", repos: ["acme/factory", "acme/web"] } }), {
    thread: "12",
    github: "github/factory",
    repos: ["acme/factory", "acme/web"],
  });
});

test("what doesn't read as a connector or a repo is dropped, and the thread still works", () => {
  assert.deepEqual(turn({ board: { thread: "12", github: "slack/factory", repos: ["acme/web", "../etc", 7, "nope"] } }), {
    thread: "12",
    github: null,
    repos: ["acme/web"],
  });
});

test("no thread, no turn", () => {
  assert.equal(turn({ board: { github: "github/factory", repos: ["acme/web"] } }), null);
  assert.equal(turn(null), null);
});

test("only this deployment's own token, or a local dev server, reaches the agent's channel", () => {
  // eve's vercelOidc() lets in every token of this project, and says which environment it's from:
  // `runtime` for this one, `service` for another, like a preview's of an unreviewed branch.
  const runtime = { principalType: "runtime", principalId: "factory" };
  const local = { principalType: "local-dev" };
  assert.equal(sameDeployment(runtime), runtime);
  assert.equal(sameDeployment(local), local);
  assert.equal(sameDeployment({ principalType: "service", principalId: "factory" }), null);
  assert.equal(sameDeployment({ principalType: "user", principalId: "u_ada" }), null);
  assert.equal(sameDeployment(null), null);
  assert.equal(sameDeployment(undefined), null);
});
