import type { Board } from "@vercel/board";
import { vb } from "@vercel/board/cli";
import { z } from "zod";
import { AVATAR, NAME } from "./identity.ts";

// The vb tool: vb's board commands, run in the function on the factory's own board handle, without
// starting `vb` in the sandbox, so typing and reads reach Slack through the board's sync. Files
// (--attach, download) are the sandbox's.

export const inputSchema = z.object({
  args: z
    .array(z.string())
    .describe(
      'vb\'s arguments, one per item, as you\'d type them after vb: ["read", "42"], ["reply", "42", "on it", "--attach", "~/shot.png"], ["label", "42", "kind=bug"], ["read", "dev", "--text", "attach"].',
    ),
});

/** The agent on `board`: this deployment, under the agent's profile. */
export const agentBoard = (board: Board): Board => board.as({ name: NAME, avatar: AVATAR });

/** The sandbox's home, where clones and skills live. */
export const SANDBOX_HOME = "/home/vercel-sandbox";

/** A path as the model writes it: `~/…` and `$HOME/…` are in the sandbox's home, as its file tools read them. */
export const sandboxPath = (path: string, home = SANDBOX_HOME) => path.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, home);

/** The sandbox's files, for --attach and download. */
export type SandboxFiles = {
  readBinaryFile(options: { path: string }): PromiseLike<Uint8Array | null>;
  writeBinaryFile(options: { path: string; content: Uint8Array }): PromiseLike<void>;
};

/** Runs a vb command as the agent, and says what it printed, as bash would: stdout, then stderr, then a failure's exit code. */
export async function runVb(board: Board, args: string[], files: () => Promise<SandboxFiles>): Promise<string> {
  const { code, stdout, stderr } = await vb(board, args, {
    // A tool call can't stream, and vb() runs one call at a time.
    refuse: ["tail", "wait"],
    readFile: async (path) => (await files()).readBinaryFile({ path: sandboxPath(path) }),
    writeFile: async (path, content) => (await files()).writeBinaryFile({ path: sandboxPath(path), content }),
  });
  return [stdout.trimEnd(), stderr.trimEnd(), code === 0 ? "" : `(exit ${code})`].filter(Boolean).join("\n") || "(no output)";
}
