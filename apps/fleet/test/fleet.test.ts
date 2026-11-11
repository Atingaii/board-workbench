// What the page is told, on a board in memory: node --test test/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { board as makeBoard, type Board } from "@vercel/board";
import { local } from "@vercel/board/backend-local";
import { finishes, snapshot } from "../lib/fleet.ts";
import { claim, create, finish } from "../lib/queue.ts";

const fresh = (): Board => makeBoard({ backend: local({ memory: true }) });
const look = (board: Board, hint = {}) => snapshot(hint, board, "fleet/");
const states = (tasks: { title: string; state: string }[]) => Object.fromEntries(tasks.map((task) => [task.title, task.state]));
async function done(board: Board, title: string): Promise<string> {
  const id = await create(board, "fleet/fixes", { title, key: title });
  const token = await claim(board, id, "ada");
  assert.ok(token);
  assert.equal(await finish(board, id, token, "done", "fleet/"), true);
  return id;
}

test("a snapshot has the fleet's tasks with their state and holder, and nothing from other channels", async () => {
  const board = fresh();
  await create(board, "fleet/fixes", { title: "ready one", brief: "the brief", key: "a" });
  const held = await create(board, "fleet/perf", { title: "held one", key: "b" });
  await claim(board, held, "grace");
  await done(board, "done one");
  await create(board, "other/fixes", { title: "another queue's", key: "c" });
  await board.post("fleet/general", "not a task");

  const snap = await look(board);
  assert.deepEqual(states(snap.tasks), { "ready one": "ready", "held one": "claimed", "done one": "done" });
  const task = snap.tasks.find((task) => task.title === "held one")!;
  assert.equal(task.owner, "grace");
  assert.equal(task.channel, "fleet/perf");
  assert.ok(Date.parse(task.lease!) > Date.now());
  assert.ok(snap.flow.some((line) => line.text === "not a task"));
  assert.ok(!snap.flow.some((line) => line.channel.startsWith("other/")));
});

test("a task that finishes between two snapshots shows as done in the next", async () => {
  const board = fresh();
  const id = await create(board, "fleet/fixes", { title: "soon done", key: "a" });
  await done(board, "done before");
  assert.deepEqual(states((await look(board)).tasks), { "soon done": "ready", "done before": "done" });

  const token = await claim(board, id, "ada");
  await finish(board, id, token!, "done", "fleet/");
  assert.deepEqual(states((await look(board)).tasks), { "soon done": "done", "done before": "done" });
});

test("a task made and finished between two snapshots shows once the caller says one finished", async () => {
  const board = fresh();
  await create(board, "fleet/fixes", { title: "still ready", key: "a" });
  await look(board);
  const after = (await board.messages({ channel: "fleet/" })).cursor;
  await done(board, "quick one");

  // What the live route does: it follows the events, and tells the snapshot when one finishes a task.
  const { events } = await board.poll({ channel: "fleet/", after, wait: 0 });
  assert.equal(events.some(finishes), true);
  assert.deepEqual(states((await look(board, { finished: events.some(finishes) })).tasks), { "still ready": "ready", "quick one": "done" });
});

test("events that finish nothing don't say a task finished", async () => {
  const board = fresh();
  const after = (await board.post("fleet/general", "hello")).id;
  const id = await create(board, "fleet/fixes", { title: "taken", key: "a" });
  await claim(board, id, "ada");
  await board.reply(id, "[progress] working");
  const { events } = await board.poll({ channel: "fleet/", after, wait: 0 });
  assert.ok(events.length >= 3);
  assert.equal(events.some(finishes), false);
});

test("a snapshot holds the newest 25 finished tasks and says there are more", async () => {
  const board = fresh();
  for (let i = 1; i <= 27; i++) await done(board, `done ${i}`);
  await create(board, "fleet/fixes", { title: "open", key: "open" });
  const snap = await look(board);
  const finished = snap.tasks.filter((task) => task.state === "done").map((task) => task.title);
  assert.equal(snap.finishedCapped, true);
  assert.deepEqual(finished, Array.from({ length: 25 }, (_, i) => `done ${27 - i}`));
  assert.equal(snap.tasks.filter((task) => task.state === "ready").length, 1);

  const few = fresh();
  await done(few, "only one");
  assert.equal((await look(few)).finishedCapped, false);
});
