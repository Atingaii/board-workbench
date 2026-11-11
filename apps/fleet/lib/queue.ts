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
 * readies the tasks that waited for it. False: the claim was lost, and nothing changed.
 */
export async function finish(board: Board, id: string, token: string, state: "done" | "review" | "ready"): Promise<boolean> {
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
  if (state === "done") await release(board, id);
  return true;
}

/**
 * A reviewer's verdict. It holds no claim, so it fences on the state: a late review can't overwrite
 * a task someone already moved. False: the task wasn't in review anymore.
 */
export async function review(board: Board, id: string, verdict: "done" | "ready"): Promise<boolean> {
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
  if (verdict === "done") await release(board, id);
  return true;
}

/** Readies every blocked task that waited for `id`. A task someone already moved stays as it is. */
async function release(board: Board, id: string): Promise<void> {
  const { threads } = await board.threads({ label: { "task.after": id, "task.state": "blocked" } });
  for (const { message } of threads) {
    await board
      .label(message.id, { set: { "task.state": "ready" }, if: { "task.state": "blocked" } })
      .catch((error: unknown) => {
        if (!lost(error)) throw error;
      });
  }
}
