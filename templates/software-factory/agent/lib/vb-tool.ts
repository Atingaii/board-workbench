import type { Board } from "@vercel/board";
import { vb } from "@vercel/board/cli";
import { z } from "zod";

// The vb tool: vb's board commands, run in the function on the factory's own board handle, as this
// deployment itself, without starting `vb` in the sandbox, so typing and reads reach Slack through
// the board's sync. Files (--attach, download) are the sandbox's.

export const inputSchema = z.object({
  args: z
    .array(z.string())
    .describe(
      'vb\'s arguments, one per item, as you\'d type them after vb: ["read", "42"], ["reply", "42", "on it", "--attach", "~/shot.png"], ["label", "42", "kind=bug"], ["read", "project-factory/", "--text", "attach"].',
    ),
});

/**
 * The agent on `board`: this deployment itself. `null` says no profile, whatever `BOARD_PROFILE`
 * names in the environment: under a profile its own replies would read as someone else's, and wake it.
 */
export const agentBoard = (board: Board): Board => board.as(null);

/** The sandbox's home, where clones and skills live. */
export const SANDBOX_HOME = "/home/vercel-sandbox";

/** A path as the model writes it: `~/…` and `$HOME/…` are in the sandbox's home, as its file tools read them. */
export const sandboxPath = (path: string, home = SANDBOX_HOME) => path.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, home);

/** The sandbox's files, for --attach and download. */
export type SandboxFiles = {
  readBinaryFile(options: { path: string }): PromiseLike<Uint8Array | null>;
  writeBinaryFile(options: { path: string; content: Uint8Array }): PromiseLike<void>;
};

/**
 * Commands the tool doesn't run. `tail` and `wait` stream, which a tool call can't, and vb() runs
 * one call at a time. The rest need `sync` or `manage`, which the board leaves out of a sandboxed
 * agent's access by default (`sandboxPolicy()`): the agent reads issues from anyone who can open
 * one, and a thread never needs them. A handle in the function can't be held to a `can` yet, so
 * they're named here.
 */
export const REFUSED = ["tail", "wait", "inbox", "sources", "grants"];

/** Runs a vb command as the agent, and says what it printed, as bash would: stdout, then stderr, then a failure's exit code. */
export async function runVb(board: Board, args: string[], files: () => Promise<SandboxFiles>): Promise<string> {
  const { code, stdout, stderr } = await vb(board, args, {
    refuse: REFUSED,
    readFile: async (path) => (await files()).readBinaryFile({ path: sandboxPath(path) }),
    writeFile: async (path, content) => (await files()).writeBinaryFile({ path: sandboxPath(path), content }),
  });
  return [stdout.trimEnd(), stderr.trimEnd(), code === 0 ? "" : `(exit ${code})`].filter(Boolean).join("\n") || "(no output)";
}
