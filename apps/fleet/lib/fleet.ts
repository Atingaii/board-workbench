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

/** The states a task is still in play in: the page shows every such task. */
const OPEN = ["ready", "claimed", "review", "blocked"] as const;
/** The states a task ends in: the page shows the newest few of each. */
const FINISHED = ["done", "canceled"] as const;
const OPEN_LIMIT = 200;
const FINISHED_LIMIT = 25;

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
 * The fleet as it is now: its newest messages, then one read per task state. A board indexes a
 * label with one value, so `task.state=ready` lists only the ready tasks, while a filter with
 * several values, or the bare key, makes Vercel's board page through every thread in every channel
 * of the fleet. Finished states are read with a small limit, so what a snapshot costs follows the
 * open tasks, not every task ever made. Nothing is kept between snapshots: each is the board as it
 * is, whoever asks and whatever they missed.
 */
export async function snapshot(board: Board = team(), fleet: string = FLEET): Promise<Snapshot> {
  // The messages first: their cursor is where the live route listens from, so a change that lands
  // between the reads is in the next snapshot rather than in neither.
  const page = await board.messages({ channel: fleet, limit: 100 });
  const read = async (state: State, limit: number) =>
    (await board.threads({ channel: fleet, label: { "task.state": state }, limit })).threads.flatMap(toTask).reverse();
  const [open, finished] = await Promise.all([
    Promise.all(OPEN.map((state) => read(state, OPEN_LIMIT))),
    Promise.all(FINISHED.map((state) => read(state, FINISHED_LIMIT))),
  ]);
  return {
    name: NAME,
    fleet,
    cursor: page.cursor,
    at: new Date().toISOString(),
    // The board lists oldest first; the page reads newest first, state by state.
    tasks: [...open.flat(), ...finished.flat()],
    finishedCapped: finished.some((tasks) => tasks.length >= FINISHED_LIMIT),
    flow: page.messages.map(line).reverse(),
  };
}

/** One task's thread: its brief, its labels, and its work log. Only a thread under the fleet. */
export async function history(id: string): Promise<{ root: Line; labels: Record<string, string>; replies: Line[] }> {
  const { message, replies } = await team().thread(id);
  if (!message.channel.startsWith(FLEET)) throw new Error(`${id} isn't in ${FLEET}`);
  return { root: line(message), labels: message.labels, replies: replies.map(line) };
}
