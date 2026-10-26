import { REPO } from "./github.ts";

// What the factory imports from GitHub but keeps on the board, out of Slack, or off the board altogether.

type GitHubEvent = { kind: string; thread: string; subthread: string | null; type: string; labels?: Record<string, string> };
type Board = { messages(query: { channel: string; label: Record<string, string>; limit: number }): Promise<{ messages: unknown[] }> };

/**
 * Whether a GitHub event's board reply stays off Slack: inline review threads (comments on
 * lines of code), and the "closed by …" reply when a PR is closed without merging. Closing
 * a batch of stale PRs posted one Slack reply each; the PR root's emoji turning
 * :pr-closed: still says it. Merges still post "merged by …".
 */
export function boardOnly(event: Pick<GitHubEvent, "subthread" | "type" | "labels">): boolean {
  if (event.subthread !== null) return true;
  return event.type === "pr.closed" && event.labels?.state === "closed";
}

type Outbound = { event: { type: string; payload: unknown }; message: { from: string | null }; deliver(): Promise<void> };

/**
 * Delivers to GitHub only what was written on the board, by people and their agents: what's said
 * in Slack stays in Slack and on the board, since a public repo would show it. A reaction counts
 * where it was made, not where the message it's on came from.
 */
export function fromBoard(sync: Outbound): Promise<void> | undefined {
  const from = sync.event.type.startsWith("reaction.") ? (sync.event.payload as { from: string | null }).from : sync.message.from;
  return from === null ? sync.deliver() : undefined;
}

/**
 * Whether a GitHub comment is on a PR the board has no thread for: one opened before the
 * board was, or while it wasn't listening. Syncing it would open a new Slack thread for an
 * old PR (a "closing as stale" comment did, for each PR it closed), so it stays on GitHub.
 * A PR's thread starts when it's opened or marked ready, so new PRs always have one.
 */
export async function unseenPr(event: GitHubEvent, board: Board, channel: string): Promise<boolean> {
  if (event.kind !== "message") return false;
  const number = /:(\d+)$/.exec(event.thread)?.[1];
  if (!number) return false;
  const { messages } = await board.messages({ channel, label: { pr: `${REPO}#${number}` }, limit: 1 });
  return messages.length === 0;
}
