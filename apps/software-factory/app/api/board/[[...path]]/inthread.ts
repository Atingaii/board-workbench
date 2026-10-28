import type { Watcher } from "@vercel/board";
import type { SyncFn } from "@vercel/board/sync";
import { REPO } from "./github.ts";
import { threadOfBranch } from "./owner.ts";

// A factory PR lives in the thread it was built for: its board thread stays off Slack, and
// the source thread gets the PR's one-line message as a reply, and a reaction on its root
// that follows the PR's state. PRs from other branches keep their own Slack thread.

/** The watcher's ID, and so its actor: Eve isn't woken by its replies. */
export const IN_THREAD = "in-thread";

/** A PR's state as the workspace's PR emoji, without colons. */
export const STATE_EMOJI: Record<string, string> = {
  open: "pr",
  draft: "pr-draft",
  merged: "pr-merged",
  closed: "pr-closed",
};

/**
 * The board thread a GitHub PR event's PR was built for, from its `board/<thread>` branch in
 * this repo (a fork's branch names nothing here), or null.
 */
export function sourceOfPr(raw: unknown): string | null {
  const head = (raw as { pull_request?: { head?: { ref?: unknown; repo?: { full_name?: unknown } | null } } } | null)
    ?.pull_request?.head;
  if (head?.repo?.full_name !== REPO) return null;
  return threadOfBranch(head.ref);
}

/**
 * The PR thread a reaction's message stands for: a PR thread's root, or a factory PR's message in
 * its source thread (labeled `pr.thread`, the PR thread's root). Null for any other message.
 */
export const prThreadOf = (message: { id: string; re: string | null; labels: Record<string, string> } | undefined) =>
  !message ? null : message.re === null ? message.id : (message.labels["pr.thread"] ?? null);

/** Whether a board message is a factory PR's root, which lives in its source thread instead of Slack's channel. */
export const livesInThread = (message: { re: string | null; labels: Record<string, string> }) =>
  message.re === null && !!message.labels.pr && !!message.labels.source;

/**
 * Slack's side of `dev`: `mirror("dev")`, except that a factory PR's root doesn't start a
 * thread in the channel. Its message goes in its source thread instead.
 */
export function devMirror(channel = "dev"): SyncFn {
  return async (sync) => {
    if (sync.direction === "in") return void (await sync.import(channel));
    if (sync.target !== null) return sync.deliver();
    if (sync.channel !== null && sync.message.channel === channel && !livesInThread(sync.message)) {
      await sync.start(sync.channel);
    }
  };
}

/**
 * Posts a factory PR's message in its source thread once its root is on the board, and keeps it
 * and the source root's reaction in step with the PR's state. The message is labeled with the PR
 * (`pr`, `state`, and `pr.thread`, the PR thread's root), so :shipit: and :security: on it act on
 * that PR, and the renderer shows it as the PR's one line. The PR root is labeled `card=<id>`.
 */
export function inThread(): Watcher {
  return {
    tail: "dev --label pr",
    run: async ({ event, board }) => {
      if (!["message.posted", "labels.changed", "message.edited"].includes(event.type)) return;
      if (!event.message || !livesInThread(event.message)) return;
      // The root as it is now, not as it was at this event: a state change or retitle logged before
      // the line's `card` label still reaches the line.
      const root = (await board.thread(event.message.id)).message;
      if (root.deleted) return;
      const source = root.labels.source!;
      const state = root.labels.state ?? "open";
      const card = root.labels.card;
      if (!card) {
        const posted = await board.reply(source, {
          text: root.text,
          labels: { pr: root.labels.pr!, state, "pr.thread": root.id },
          id: `pr-card-${root.id}`,
        });
        await board.label(root.id, { set: { card: posted.id } });
        await react(board, source, state);
        return;
      }
      if (event.type === "labels.changed" && "state" in ((event.payload as { set?: object }).set ?? {})) {
        await board.label(card, { set: { state } });
        await react(board, source, state);
      } else if (event.type === "message.edited") {
        await board.edit(card, root.text);
      }
    },
  };
}

/** Puts the state's emoji on the source root and takes the other PR emoji off it. */
async function react(board: { react(id: string, emoji: string, opts?: { remove?: boolean }): Promise<unknown> }, source: string, state: string) {
  const emoji = STATE_EMOJI[state];
  if (!emoji) return;
  for (const other of Object.values(STATE_EMOJI)) {
    if (other !== emoji) await board.react(source, other, { remove: true });
  }
  await board.react(source, emoji);
}
