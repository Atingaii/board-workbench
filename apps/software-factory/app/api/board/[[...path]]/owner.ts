import type { Watcher } from "vboard";
import { getToken } from "@vercel/connect";

/** The board thread a factory PR was built for, from its `pi/<thread>` branch (`pi/1559`, `pi/1559-vercel-logs`). */
export const threadOfBranch = (ref: unknown) => {
  const match = typeof ref === "string" ? /^pi\/([1-9]\d*)(?:-|$)/.exec(ref) : null;
  return match ? Number(match[1]) : null;
};

/**
 * Labels a factory PR's thread with its owner, the person who opened the board thread the PR
 * was built for: `owner=<actor>` and `owner.name=<name>`. The Slack renderer shows them on the
 * PR's root, so a PR the factory bot opened says whose it is. PRs from other branches are skipped:
 * their author already shows.
 */
export function owner(options: { token?: () => Promise<string>; fetch?: typeof fetch } = {}): Watcher {
  const request = options.fetch ?? globalThis.fetch;
  return {
    tail: "dev --label pr",
    run: async ({ event, board }) => {
      const root = event.message;
      if (event.type !== "message.posted" || !root || root.re !== null || root.labels.owner) return;
      const number = root.labels.pr?.match(/^basehub-ai\/vboard#([1-9]\d*)$/)?.[1];
      if (!number) return;
      const token = await (options.token?.() ?? getToken("github/vboard-factory", { subject: { type: "app" } }));
      const response = await request(`https://api.github.com/repos/basehub-ai/vboard/pulls/${number}`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2026-03-10",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status} for PR #${number}`);
      const pr = await response.json();
      const source = threadOfBranch(pr.head?.ref);
      if (!source) return;
      const { message } = await board.thread(source);
      const name = message.author?.name ?? message.author?.handle ?? message.by.actor;
      await board.label(root.id, { set: { owner: message.by.actor, "owner.name": name } });
    },
  };
}
