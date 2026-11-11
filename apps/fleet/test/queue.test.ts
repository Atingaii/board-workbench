// The queue's promises, on a board in memory: node --test test/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { board as makeBoard, type Board } from "@vercel/board";
import { local } from "@vercel/board/backend-local";
import { claim, create, finish, renew, review } from "../lib/queue.ts";

const fresh = (): Board => makeBoard({ backend: local({ memory: true }) });
const labels = async (board: Board, id: string) => (await board.thread(id)).message.labels;
let n = 0;
const task = (board: Board, after?: string) => create(board, "fleet/fixes", { title: `task ${++n}`, key: `key-${n}`, after });

test("a retried create posts one task", async () => {
  const board = fresh();
  const first = await create(board, "fleet/fixes", { title: "Fix the redirect", brief: "Same-origin only.", key: "fix-redirect" });
  const again = await create(board, "fleet/fixes", { title: "Fix the redirect", brief: "Same-origin only.", key: "fix-redirect" });
  assert.equal(again, first);
  const { threads } = await board.threads({ channel: "fleet/fixes" });
  assert.equal(threads.length, 1);
  assert.equal(threads[0]!.message.text, "Fix the redirect\n\nSame-origin only.");
  assert.equal(threads[0]!.message.labels["task.state"], "ready");
});

test("of many agents claiming one task at once, one gets it", async () => {
  const board = fresh();
  const id = await task(board);
  const agents = ["ada", "grace", "linus", "ken", "barbara", "edsger", "margaret", "dennis"];
  const tokens = await Promise.all(agents.map((agent) => claim(board, id, agent)));
  const winners = agents.filter((_, i) => tokens[i] !== null);
  assert.equal(winners.length, 1);
  const now = await labels(board, id);
  assert.equal(now["task.state"], "claimed");
  assert.equal(now["task.owner"], winners[0]);
  assert.equal(now["task.claim"], tokens.find((token) => token !== null));
});

test("a claim holds for about ten minutes, and a renewal moves its end later", async () => {
  const board = fresh();
  const id = await task(board);
  const before = Date.now();
  const token = await claim(board, id, "ada");
  assert.ok(token);
  const first = Date.parse((await labels(board, id))["task.lease"]!);
  assert.ok(first >= before + 9 * 60_000 && first <= Date.now() + 11 * 60_000, `lease ends ${first - before} ms out`);
  await new Promise((resolve) => setTimeout(resolve, 1_100)); // a lease is kept to the second
  assert.equal(await renew(board, id, token), true);
  assert.ok(Date.parse((await labels(board, id))["task.lease"]!) > first);
});

test("a task taken over fences out the agent that held it", async () => {
  const board = fresh();
  const id = await task(board);
  const old = await claim(board, id, "ada");
  assert.ok(old);
  const held = await labels(board, id);
  // The takeover JOIN.md gives: all three conditions, so one taker wins.
  await board.label(id, {
    set: { "task.owner": "grace", "task.claim": "graces-claim", "task.lease": "2999-01-01T00:00:00.000Z" },
    if: { "task.state": "claimed", "task.claim": old, "task.lease": held["task.lease"]! },
  });
  assert.equal(await renew(board, id, old), false);
  assert.equal(await finish(board, id, old, "done"), false);
  const now = await labels(board, id);
  assert.equal(now["task.state"], "claimed");
  assert.equal(now["task.owner"], "grace");
  assert.equal(now["task.lease"], "2999-01-01T00:00:00.000Z");
});

test("a done task readies the tasks that waited for it, and no others", async () => {
  const board = fresh();
  const first = await task(board);
  const other = await task(board);
  const waits = await task(board, first);
  const waitsForOther = await task(board, other);
  assert.equal((await labels(board, waits))["task.state"], "blocked");
  assert.equal(await claim(board, waits, "grace"), null, "a blocked task can't be claimed");

  const token = await claim(board, first, "ada");
  assert.ok(token);
  assert.equal(await finish(board, first, token, "done"), true);

  const done = await labels(board, first);
  assert.equal(done["task.state"], "done");
  assert.equal(done["task.owner"], "ada", "a done task still says who did it");
  assert.equal(done["task.claim"], undefined);
  assert.equal(done["task.lease"], undefined);
  assert.equal((await labels(board, waits))["task.state"], "ready");
  assert.equal((await labels(board, waitsForOther))["task.state"], "blocked");
});

test("a task in review readies what waits for it only once a reviewer says done", async () => {
  const board = fresh();
  const first = await task(board);
  const waits = await task(board, first);
  const token = await claim(board, first, "ada");
  assert.ok(token);
  assert.equal(await finish(board, first, token, "review"), true);
  assert.equal((await labels(board, first))["task.state"], "review");
  assert.equal((await labels(board, waits))["task.state"], "blocked");

  assert.equal(await review(board, first, "done"), true);
  assert.equal((await labels(board, first))["task.state"], "done");
  assert.equal((await labels(board, waits))["task.state"], "ready");
  assert.equal(await review(board, first, "ready"), false, "a second verdict comes too late");
  assert.equal((await labels(board, first))["task.state"], "done");
});

test("a review that sends a task back makes it claimable again, by anyone", async () => {
  const board = fresh();
  const id = await task(board);
  const token = await claim(board, id, "ada");
  assert.ok(token);
  await finish(board, id, token, "review");
  assert.equal(await review(board, id, "ready"), true);
  const back = await labels(board, id);
  assert.equal(back["task.state"], "ready");
  assert.equal(back["task.owner"], undefined);
  assert.ok(await claim(board, id, "grace"));
});

test("an agent that gives a task back leaves it ready, with no trace of the claim", async () => {
  const board = fresh();
  const id = await task(board);
  const token = await claim(board, id, "ada");
  assert.ok(token);
  assert.equal(await finish(board, id, token, "ready"), true);
  const back = await labels(board, id);
  assert.deepEqual(
    { state: back["task.state"], owner: back["task.owner"], claim: back["task.claim"], lease: back["task.lease"] },
    { state: "ready", owner: undefined, claim: undefined, lease: undefined },
  );
  assert.equal(await renew(board, id, token), false, "the old token no longer holds it");
  assert.ok(await claim(board, id, "grace"));
});
