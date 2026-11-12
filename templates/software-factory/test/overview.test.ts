import assert from "node:assert/strict";
import { test } from "node:test";
import { duration, overview } from "../lib/overview.ts";

// What the page shows once the factory runs, worked out from messages as the board gives them.

const DEPLOYMENT = "vercel:project:prj_factory:production";
const NOW = new Date("2026-11-12T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const SECOND = 1000;
const HOUR = 3600 * SECOND;
const DAY = 24 * HOUR;

let next = 0;
type By = "ada" | "agent" | "sync" | "watcher";
const BY: Record<By, { principal: string; profile: string | null }> = {
  ada: { principal: "vercel:user:u_ada", profile: null },
  agent: { principal: DEPLOYMENT, profile: null },
  sync: { principal: DEPLOYMENT, profile: "github:user:583231" },
  watcher: { principal: DEPLOYMENT, profile: "wake" },
};
const message = (re: string | null, by: By, at: number, more: { id?: string; text?: string; labels?: Record<string, string> } = {}) =>
  ({ id: more.id ?? `m${++next}`, re, text: more.text ?? "", labels: more.labels ?? {}, createdAt: ago(at), by: { ...BY[by], actor: "a" } }) as never;

const week = (recent: never[], limit = 200) => overview(recent, [], DEPLOYMENT, NOW, limit).week;

test("the week is the threads with a message in the last 7 days, their messages in it, and the ones the agent answered", () => {
  const recent = [
    // Started before the week, answered in it.
    message(null, "ada", 10 * DAY, { id: "a" }),
    message("a", "agent", 2 * DAY),
    // In the week, and nobody answered.
    message(null, "sync", DAY, { id: "b" }),
    // All of it before the week.
    message(null, "ada", 20 * DAY, { id: "c" }),
    message("c", "agent", 19 * DAY),
  ];
  const { threads, messages, answered } = week(recent);
  assert.deepEqual({ threads, messages, answered }, { threads: 2, messages: 2, answered: 1 });
});

test("the wait for a first reply is from a thread's first message that isn't the agent's to the agent's next, as the median", () => {
  const thread = (id: string, start: number, wait: number) => [message(null, "ada", start, { id }), message(id, "agent", start - wait), message(id, "agent", start - wait - HOUR)];
  const recent = [
    ...thread("a", DAY, 10 * SECOND),
    ...thread("b", 2 * DAY, 20 * SECOND),
    ...thread("c", 3 * DAY, 60 * SECOND),
    // A thread the agent started, which someone then answered: nobody waited on the agent.
    message(null, "agent", 4 * DAY, { id: "d" }),
    message("d", "ada", 4 * DAY - HOUR),
    // The watcher's own word isn't an answer.
    message(null, "ada", 5 * DAY, { id: "e" }),
    message("e", "watcher", 5 * DAY - SECOND),
  ];
  assert.equal(week(recent).firstReplyMs, 20 * SECOND);
  // With an even count, halfway between the middle two.
  assert.equal(week([...thread("a", DAY, 10 * SECOND), ...thread("b", 2 * DAY, 20 * SECOND)]).firstReplyMs, 15 * SECOND);
  assert.equal(week([message(null, "ada", DAY)]).firstReplyMs, null);
});

test("a read that came back full says the week may hold more", () => {
  const recent = [message(null, "ada", DAY), message(null, "ada", 2 * DAY)];
  assert.equal(week(recent, 2).more, true);
  assert.equal(week(recent, 3).more, false);
});

test("the last reply is the agent's latest message, whenever it was", () => {
  const recent = [message(null, "ada", HOUR, { id: "a" }), message("a", "agent", 30 * DAY), message("a", "agent", 9 * DAY), message("a", "sync", HOUR)];
  assert.equal(overview(recent, [], DEPLOYMENT, NOW, 200).lastReplyAt, ago(9 * DAY));
  assert.equal(overview([message(null, "ada", HOUR)], [], DEPLOYMENT, NOW, 200).lastReplyAt, null);
});

test("pull requests are counted by the state their thread is labeled with, and the open ones are listed with where they are", () => {
  const pull = (repo: string, number: number, state: string, title = "a title") =>
    message(null, "sync", DAY, { id: `pr${number}`, text: `PR #${number}: ${title}\nhttps://github.com/${repo}/pull/${number}`, labels: { pr: `${repo}#${number}`, state } });
  const pulls = [
    pull("acme/web", 12, "open", "Fix the build"),
    pull("acme/factory", 3, "draft", "Remove the Deploy button"),
    pull("acme/web", 11, "merged"),
    pull("acme/web", 10, "merged"),
    pull("acme/web", 9, "closed"),
  ];
  assert.deepEqual(overview([], pulls, DEPLOYMENT, NOW, 200).pulls, {
    open: [
      { repo: "acme/web", number: 12, title: "Fix the build", url: "https://github.com/acme/web/pull/12", draft: false },
      { repo: "acme/factory", number: 3, title: "Remove the Deploy button", url: "https://github.com/acme/factory/pull/3", draft: true },
    ],
    merged: 2,
    closed: 1,
  });
});

test("a length of time reads as people say it", () => {
  assert.deepEqual([14 * SECOND, 59.6 * SECOND, 3 * 60 * SECOND, 2 * HOUR, 5 * DAY, -SECOND].map(duration), ["14s", "1m", "3m", "2h", "5d", "0s"]);
});
