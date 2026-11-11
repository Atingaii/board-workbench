import type { MessageView } from "@vercel/board";
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
  tasks: Task[];
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

/** The fleet as it is now: two reads, whoever looks and however big the board is. */
export async function snapshot(): Promise<Snapshot> {
  const board = team();
  // The messages first: their cursor is where the live route listens from, so a change that lands
  // between the two reads is in the next snapshot rather than in neither.
  const page = await board.messages({ channel: FLEET, limit: 100 });
  const { threads } = await board.threads({ channel: FLEET, label: ["task.state"], limit: 500 });
  const tasks = threads.flatMap(({ message, replies, last }): Task[] => {
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
  });
  return {
    name: NAME,
    fleet: FLEET,
    cursor: page.cursor,
    at: new Date().toISOString(),
    // The board lists both oldest first; the page reads newest first.
    tasks: tasks.reverse(),
    flow: page.messages.map(line).reverse(),
  };
}

/** One task's thread: its brief, its labels, and its work log. Only a thread under the fleet. */
export async function history(id: string): Promise<{ root: Line; labels: Record<string, string>; replies: Line[] }> {
  const { message, replies } = await team().thread(id);
  if (!message.channel.startsWith(FLEET)) throw new Error(`${id} isn't in ${FLEET}`);
  return { root: line(message), labels: message.labels, replies: replies.map(line) };
}
