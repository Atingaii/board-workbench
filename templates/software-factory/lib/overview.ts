import type { MessageView } from "@vercel/board";
import { byAgent } from "../agent/lib/identity.ts";

// What the page shows once the factory runs: the week in its channels and its pull requests, worked
// out from what the board already has. Nothing here is kept: every load reads again.

/** A pull request the board has a thread for, still open. */
export type Pull = { repo: string; number: number; title: string; url: string; draft: boolean };

export type Overview = {
  /**
   * The last 7 days in the factory's channels: threads with a message in them, messages, the threads
   * the agent answered, and how long a thread waited for its first answer, as the median. `more`
   * says the board had more than one read brings, so the week may hold more than this counts.
   */
  week: { threads: number; messages: number; answered: number; firstReplyMs: number | null; more: boolean };
  /** When the agent last wrote, in what was read. */
  lastReplyAt: string | null;
  pulls: { open: Pull[]; merged: number; closed: number };
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
};

/**
 * `recent` is the latest messages in the factory's channels, a read of at most `limit`; `pulls`,
 * the messages there labeled as a pull request's; `principal`, who this deployment is on the board,
 * which tells the agent's messages from the rest.
 */
export function overview(recent: MessageView[], pulls: MessageView[], principal: string, now: Date, limit: number): Overview {
  const at = (message: MessageView) => Date.parse(message.createdAt);
  const agent = (message: MessageView) => byAgent(message.by, principal);
  const threads = new Map<string, MessageView[]>();
  for (const message of [...recent].sort((a, b) => at(a) - at(b))) {
    const thread = message.re ?? message.id;
    threads.set(thread, [...(threads.get(thread) ?? []), message]);
  }
  const since = now.getTime() - WEEK_MS;
  const week = [...threads.values()].filter((messages) => messages.some((message) => at(message) >= since));
  // A thread's wait: from the first message that isn't the agent's to the agent's first one after it.
  const waits = week.flatMap((messages) => {
    const asked = messages.find((message) => !agent(message));
    const answered = asked && messages.find((message) => agent(message) && at(message) >= at(asked));
    return asked && answered ? [at(answered) - at(asked)] : [];
  });
  const replies = recent.filter(agent).map(at);

  const roots = pulls.filter((message) => message.re === null && message.labels.pr);
  const state = (message: MessageView) => message.labels.state;
  return {
    week: {
      threads: week.length,
      messages: recent.filter((message) => at(message) >= since).length,
      answered: week.filter((messages) => messages.some(agent)).length,
      firstReplyMs: median(waits),
      more: recent.length >= limit,
    },
    lastReplyAt: replies.length ? new Date(Math.max(...replies)).toISOString() : null,
    pulls: {
      open: roots.filter((message) => state(message) === "open" || state(message) === "draft").flatMap((message) => {
        // The label is `owner/repo#12`, and the root's first line names it: `PR #12: its title`.
        const [, repo, number] = /^(.+)#(\d+)$/.exec(message.labels.pr ?? "") ?? [];
        if (!repo || !number) return [];
        const title = (message.text.split("\n")[0] ?? "").replace(/^PR #\d+: /, "");
        return [{ repo, number: Number(number), title, url: `https://github.com/${repo}/pull/${number}`, draft: state(message) === "draft" }];
      }),
      merged: roots.filter((message) => state(message) === "merged").length,
      closed: roots.filter((message) => state(message) === "closed").length,
    },
  };
}

/** A length of time as people say it: `14s`, `3m`, `2h`, `5d`. */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}
