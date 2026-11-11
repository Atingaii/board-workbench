import { randomUUID } from "node:crypto";
import { BoardError, type Board } from "@vercel/board";

// The work queue, as the board skill's work-queue reference has it: a thread's root is the task,
// its replies are the work log, and the root's labels hold the state. Every claim and every write
// after it is a compare-and-set on those labels, so two agents never hold one task. JOIN.md gives
// agents the same steps as CLI commands; the scripts here take them from code.

export const STATES = ["ready", "claimed", "review", "blocked", "done", "canceled"] as const;
export type State = (typeof STATES)[number];

/** How long a claim holds without a renewal. A crashed agent keeps a task this long at most. */
export const LEASE_MS = 10 * 60_000;

const lease = () => new Date(Date.now() + LEASE_MS).toISOString();

/** True when the board refused the write because a label wasn't what `if` said. */
const lost = (error: unknown) => error instanceof BoardError && error.code === "label_conflict";

/** A task: its first line is the title, the rest the brief. `key` makes a retried create land once. */
export async function create(
  board: Board,
  channel: string,
  task: { title: string; brief?: string; key: string; after?: string },
): Promise<string> {
  const message = await board.post(channel, {
    text: task.brief ? `${task.title}\n\n${task.brief}` : task.title,
    labels: task.after ? { "task.state": "blocked", "task.after": task.after } : { "task.state": "ready" },
    id: task.key,
  });
  return message.id;
}

/** Claims a ready task for `owner`. The token fences every later write, or null: someone was first. */
export async function claim(board: Board, id: string, owner: string): Promise<string | null> {
  const token = randomUUID();
  try {
    await board.label(id, {
      set: { "task.state": "claimed", "task.owner": owner, "task.claim": token, "task.lease": lease() },
      if: { "task.state": "ready" },
    });
    return token;
  } catch (error) {
    if (lost(error)) return null;
    throw error;
  }
}

/** Extends the lease. False: the claim is someone else's now, so stop working on the task. */
export async function renew(board: Board, id: string, token: string): Promise<boolean> {
  try {
    await board.label(id, { set: { "task.lease": lease() }, if: { "task.claim": token } });
    return true;
  } catch (error) {
    if (lost(error)) return false;
    throw error;
  }
}

/**
 * Ends the claim: `done`, `review` for someone to check it, or `ready` to give it back. A done task
 * readies the tasks under `scope` that waited for it. False: the claim was lost, and nothing changed.
 */
export async function finish(board: Board, id: string, token: string, state: "done" | "review" | "ready", scope: string): Promise<boolean> {
  try {
    await board.label(id, {
      set: { "task.state": state },
      unset: state === "ready" ? ["task.owner", "task.claim", "task.lease"] : ["task.claim", "task.lease"],
      if: { "task.claim": token },
    });
  } catch (error) {
    if (lost(error)) return false;
    throw error;
  }
  if (state === "done") await release(board, id, scope);
  return true;
}

/**
 * A reviewer's verdict. It holds no claim, so it fences on the state: a late review can't overwrite
 * a task someone already moved. False: the task wasn't in review anymore.
 */
export async function review(board: Board, id: string, verdict: "done" | "ready", scope: string): Promise<boolean> {
  try {
    await board.label(id, {
      set: { "task.state": verdict },
      unset: verdict === "ready" ? ["task.owner"] : [],
      if: { "task.state": "review" },
    });
  } catch (error) {
    if (lost(error)) return false;
    throw error;
  }
  if (verdict === "done") await release(board, id, scope);
  return true;
}

/** How many dependents one read asks for. A readied task leaves the list, so the next read has the rest. */
const PAGE = 100;

/**
 * Readies every blocked task under `scope` (the queue's channels, `fleet/`) that waited for `id`.
 * The scope keeps the read to the queue: without it, a board lists every channel the caller can
 * read. A task someone already moved stays as it is.
 */
async function release(board: Board, id: string, scope: string): Promise<void> {
  // Each pass readies what it lists, so the passes end. The cap is for a board that keeps listing them.
  for (let pass = 0; pass < 50; pass++) {
    const { threads } = await board.threads({ channel: scope, label: { "task.after": id, "task.state": "blocked" }, limit: PAGE });
    for (const { message } of threads) {
      await board
        .label(message.id, { set: { "task.state": "ready" }, if: { "task.state": "blocked" } })
        .catch((error: unknown) => {
          if (!lost(error)) throw error;
        });
    }
    if (threads.length < PAGE) return;
  }
}
