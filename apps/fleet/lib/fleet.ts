import type { Board, MessageView, ThreadSummaryView } from "@vercel/board";
import { FLEET, NAME, team } from "./board.ts";
import { STATES, type State } from "./queue.ts";

/** A message as the page shows it. */
export type Line = { id: string; channel: string; re: string | null; author: string; text: string; at: string };

/** A task: a thread whose root carries `task.state`. */
export type Task = {
  id: string;
  channel: string;
  title: string;
  state: State;
  /** Who holds it, or held it last, by handle. */
  owner: string | null;
  /** When the claim runs out. A claimed task past it has stalled, and anyone may take it over. */
  lease: string | null;
  /** The task a blocked one waits for. */
  after: string | null;
  author: string;
  replies: number;
  last: Line | null;
  createdAt: string;
};

export type Snapshot = {
  name: string;
  fleet: string;
  /** The board's position this was read at: the live route follows on from it. */
  cursor: string;
  at: string;
  /** Every open task, and the latest few finished ones. */
  tasks: Task[];
  /** True when there are more finished tasks than `tasks` holds, so a count of them is a floor. */
  finishedCapped: boolean;
  /** The latest messages under the fleet, newest first. */
  flow: Line[];
};

const author = (message: MessageView) => message.author?.handle ?? message.by.actor;

const line = (message: MessageView): Line => ({
  id: message.id,
  channel: message.channel,
  re: message.re,
  author: author(message),
  text: message.text,
  at: message.createdAt,
});

/** The states a task is still in play in. Finished tasks are read apart, and only a few. */
const OPEN = "ready|claimed|review|blocked";
const FINISHED = "done|canceled";
const OPEN_LIMIT = 200;
const FINISHED_LIMIT = 25;
/** Finished tasks are read again when one finishes, or after this long. */
const FINISHED_FOR_MS = 60_000;

/** A board's last finished read, and which tasks were open then: per instance, and safe to lose. */
const keeps = new WeakMap<Board, { finished: Task[]; open: Set<string>; at: number }>();

/** True for an event about a task that is finished now: the live route's cue that the finished list moved. */
export const finishes = (event: { message?: MessageView }): boolean =>
  FINISHED.split("|").includes(event.message?.labels["task.state"] ?? "");

function toTask({ message, replies, last }: ThreadSummaryView): Task[] {
  const state = message.labels["task.state"] as State | undefined;
  // A label anyone can write: one this page doesn't know isn't a task.
  if (!state || !STATES.includes(state)) return [];
  return [
    {
      id: message.id,
      channel: message.channel,
      title: message.text.split("\n", 1)[0] || "(no title)",
      state,
      owner: message.labels["task.owner"] ?? null,
      lease: message.labels["task.lease"] ?? null,
      after: message.labels["task.after"] ?? null,
      author: author(message),
      replies,
      last: last ? line(last) : null,
      createdAt: message.createdAt,
    },
  ];
}

/**
 * The fleet as it is now. What it reads grows with the open tasks, not with every task ever made:
 * the newest messages, the open tasks by their state, and the finished ones only when one may have
 * finished since the last look. On Vercel's board a thread summary costs requests of its own, so a
 * done task that stayed in every snapshot would cost on every change, forever.
 *
 * A task may have finished when one left the open set, or when the caller saw it happen
 * (`finished`, from the events it follows): a task made and finished between two snapshots was
 * never in an open set to leave.
 */
export async function snapshot(hint: { finished?: boolean } = {}, board: Board = team(), fleet: string = FLEET): Promise<Snapshot> {
  // The messages first: their cursor is where the live route listens from, so a change that lands
  // between the reads is in the next snapshot rather than in neither.
  const page = await board.messages({ channel: fleet, limit: 100 });
  const open = (await board.threads({ channel: fleet, label: { "task.state": OPEN }, limit: OPEN_LIMIT })).threads.flatMap(toTask);
  const ids = new Set(open.map((task) => task.id));
  let kept = keeps.get(board);
  const left = kept ? [...kept.open].some((id) => !ids.has(id)) : true;
  if (!kept || left || hint.finished || Date.now() - kept.at > FINISHED_FOR_MS) {
    const { threads } = await board.threads({ channel: fleet, label: { "task.state": FINISHED }, limit: FINISHED_LIMIT });
    kept = { finished: threads.flatMap(toTask), open: ids, at: Date.now() };
    keeps.set(board, kept);
  } else {
    kept.open = ids;
  }
  return {
    name: NAME,
    fleet,
    cursor: page.cursor,
    at: new Date().toISOString(),
    // The board lists oldest first; the page reads newest first.
    tasks: [...open.reverse(), ...[...kept.finished].reverse()],
    finishedCapped: kept.finished.length >= FINISHED_LIMIT,
    flow: page.messages.map(line).reverse(),
  };
}

/** One task's thread: its brief, its labels, and its work log. Only a thread under the fleet. */
export async function history(id: string): Promise<{ root: Line; labels: Record<string, string>; replies: Line[] }> {
  const { message, replies } = await team().thread(id);
  if (!message.channel.startsWith(FLEET)) throw new Error(`${id} isn't in ${FLEET}`);
  return { root: line(message), labels: message.labels, replies: replies.map(line) };
}
