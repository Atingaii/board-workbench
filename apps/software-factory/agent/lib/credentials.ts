import { defineState } from "eve/context";
import type { ToolContext } from "eve/tools";
import { BOARD, evePolicy, piName } from "../../app/api/board/[[...path]]/harness.ts";
import { CONNECTOR } from "../../app/api/board/[[...path]]/github.ts";
import { expiresAt, REFRESH_LEAD_MS } from "../../app/api/board/[[...path]]/tokens.ts";
import { environment } from "../sandbox";
import type { SandboxNetworkPolicy } from "eve/sandbox";
import type { Board } from "./board";

// The sandbox's credentials: the board's (as this thread's agent), AI Gateway's (for ui-video's voice), and the factory
// GitHub App's, for gh and git. They live in the network policy, never in the sandbox. They're handed over when a turn starts and again before
// they die, from eve's own functions: no timer of their own, as Pi's need (`tokens.ts`).

/** How long a GitHub token has left when it's handed over: Connect hands out cached ones with at least this much. */
const GITHUB_MS = 30 * 60_000;
const GIT_EMAIL = "pi@vboard-factory.playground-vercel.tools";

/** When the sandbox's tokens die, and whose they are; 0 before it has any. */
const given = defineState("factory.credentials", () => ({ until: 0, thread: "" }));

/** Whether a sandbox that has tokens until `until` for `had` needs new ones for `board` at `now`. */
export const stale = (until: number, had: string, board: Board, now: number) =>
  had !== board.thread || until - REFRESH_LEAD_MS <= now;

type Ctx = Pick<ToolContext, "getSandbox">;

/** Hands the sandbox fresh tokens for `board` when the ones it has are near their end, or another thread's. */
export async function give(ctx: Ctx, board: Board, now = Date.now()) {
  const { until, thread } = given.get();
  if (!stale(until, thread, board, now)) return;
  const [{ getToken }, { getVercelOidcToken }] = await Promise.all([import("@vercel/connect"), import("@vercel/oidc")]);
  const [gateway, boardToken, github] = await Promise.all([
    getVercelOidcToken(),
    getVercelOidcToken({ audience: BOARD }),
    getToken(CONNECTOR, { subject: { type: "app" }, validityBufferMs: GITHUB_MS }),
  ]);
  const sandbox = await ctx.getSandbox(environment);
  await sandbox.setNetworkPolicy(
    evePolicy(board.thread, { gateway, board: boardToken, github }, process.env.VERCEL_AUTOMATION_BYPASS_SECRET) as SandboxNetworkPolicy,
  );
  if (thread !== board.thread) {
    // Commits name the thread's agent, as Pi's do; the app's token pushes them.
    const git = await sandbox.run({
      command: `git config --global user.name ${JSON.stringify(piName(board.thread))} && git config --global user.email ${GIT_EMAIL}`,
    });
    if (git.exitCode !== 0) throw new Error(`git config failed: ${git.stderr.slice(-300)}`);
  }
  given.update(() => ({ until: Math.min(expiresAt(gateway), expiresAt(boardToken), now + GITHUB_MS), thread: board.thread }));
}
