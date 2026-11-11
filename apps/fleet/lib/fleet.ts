import type { MessageView, ThreadSummaryView } from "@vercel/board";
import { FLEET, NAME, team } from "@/lib/board";
import { STATES, type State } from "@/lib/queue";

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
/** Finished tasks are read again when a task leaves the open set, or after this long. */
const FINISHED_FOR_MS = 5 * 60_000;

/** The last finished read, and which tasks were open then: per instance, and safe to lose. */
let kept: { finished: Task[]; open: Set<string>; at: number } | undefined;

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
 * the newest messages, the open tasks by their state, and the finished ones only when a task has
 * left the open set since the last look. On Vercel's board a thread summary costs requests of its
 * own, so a done task that stayed in every snapshot would cost on every change, forever.
 */
export async function snapshot(): Promise<Snapshot> {
  const board = team();
  // The messages first: their cursor is where the live route listens from, so a change that lands
  // between the reads is in the next snapshot rather than in neither.
  const page = await board.messages({ channel: FLEET, limit: 100 });
  const open = (await board.threads({ channel: FLEET, label: { "task.state": OPEN }, limit: OPEN_LIMIT })).threads.flatMap(toTask);
  const ids = new Set(open.map((task) => task.id));
  const left = kept ? [...kept.open].some((id) => !ids.has(id)) : true;
  if (!kept || left || Date.now() - kept.at > FINISHED_FOR_MS) {
    const { threads } = await board.threads({ channel: FLEET, label: { "task.state": FINISHED }, limit: FINISHED_LIMIT });
    kept = { finished: threads.flatMap(toTask), open: ids, at: Date.now() };
  } else {
    kept.open = ids;
  }
  return {
    name: NAME,
    fleet: FLEET,
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
