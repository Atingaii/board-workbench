import type { Task } from "../../app/api/board/[[...path]]/harness.ts";

// Which thread's agent a session is. The factory sends it with every message (`boardContext` in `eve.ts`), and the
// eve channel (`channels/eve.ts`) makes it part of the turn's auth, which tools, hooks and instructions all see.

export type Board = { task: Task; thread: string };

const THREAD = /^[A-Za-z0-9_-]{1,64}$/;

/** The board context in a message's client context, when it's well formed. */
export function boardFrom(context: unknown): Board | null {
  const board = (context as { board?: { task?: unknown; thread?: unknown } } | null)?.board;
  if (!board || (board.task !== "thread" && board.task !== "review")) return null;
  if (typeof board.thread !== "string" || !THREAD.test(board.thread)) return null;
  return { task: board.task, thread: board.thread };
}

type Auth = { attributes: Readonly<Record<string, string | readonly string[]>> } | null | undefined;

/** The thread a session works on, from the turn's auth, or the session's first. */
export function boardOf(session: { auth: { current: Auth; initiator: Auth } }): Board | null {
  for (const auth of [session.auth.current, session.auth.initiator]) {
    const { boardTask: task, boardThread: thread } = auth?.attributes ?? {};
    const board = boardFrom({ board: { task, thread } });
    if (board) return board;
  }
  return null;
}
