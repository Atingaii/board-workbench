import type { Board, MessageView } from "@vercel/board";
import type { AgentMessage } from "../agent/lib/wake.ts";

// Onboarding a repo from the page: the factory is asked as anyone would ask it, in the thread it
// opens for it, and its agent does the rest (the onboard-repo skill): a pull request to this
// factory's own repo.

/** Where the page, or an agent, asks for a repo: a POST with `{ "repo": "<owner>/<repo>" }`. */
export const ONBOARD_PATH = "/api/launcher/onboard";

/**
 * A repo as GitHub writes it, from what someone typed or pasted: `acme/web`, or its URL. Nothing
 * when it isn't one: what's kept goes into a message the agent reads, so it's a repo's name and
 * no more.
 */
export function repoName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\/$/, "")
    .replace(/\.git$/i, "");
  // An owner is letters, digits and single hyphens, 39 at most; a repo adds `.` and `_`, 100 at most.
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(name)) return null;
  return /\/\.{1,2}$/.test(name) ? null : name;
}

/** The repo among the ones that already come into the board, as its map writes it, whatever the case it was asked in. */
export const onboarded = (repo: string, repoChannels: Record<string, string>): string | null =>
  Object.keys(repoChannels).find((name) => name.toLowerCase() === repo.toLowerCase()) ?? null;

/** What the factory is asked, as the thread's first message. */
export const onboardText = (repo: string) => `Onboard ${repo}. Asked from this factory's page.`;

/**
 * Asks: the factory opens the thread itself, where it changes itself, and hands it to its agent as
 * the watcher would. The agent's own message wakes nobody, so the wake-up is sent here. Asked
 * twice, there are two threads, as when two people ask: the agent looks for earlier work first.
 */
export async function startOnboarding(agent: Pick<Board, "post">, channel: string, repo: string, wake: (message: AgentMessage) => Promise<void>): Promise<MessageView> {
  const root = await agent.post(channel, { text: onboardText(repo) });
  await wake({ thread: root.id, key: `onboard-${root.id}`, text: `New board thread #${root.id}.` });
  return root;
}
