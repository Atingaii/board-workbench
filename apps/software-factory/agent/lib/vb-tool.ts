import { board as boardAt, type Board } from "@vercel/board";
import { http } from "@vercel/board/backend-http";
import { vb } from "@vercel/board/cli";
import { z } from "zod";
import { BOARD, eveAvatar, eveHeaders, eveName, SANDBOX_USER } from "../../app/api/board/[[...path]]/harness.ts";

// The vb tool: vb's board commands, run in the function against the board, without starting `vb` in
// the sandbox. It's who `vb` is there: the same token, profile, and session the sandbox's network
// policy adds. Files (--attach, download) are the sandbox's.

export const inputSchema = z.object({
  args: z
    .array(z.string())
    .describe(
      'vb\'s arguments, one per item, as you\'d type them after vb: ["read", "42"], ["reply", "42", "on it", "--attach", "~/shot.png"], ["label", "42", "kind=bug"], ["read", "dev", "--text", "attach"].',
    ),
});

export type VbInput = z.infer<typeof inputSchema>;

/** A thread's Eve on the board, through `fetch`, with a fresh token for each request. */
export function eveBoard(
  thread: string,
  options: { token: () => Promise<string>; bypass?: string | undefined; fetch?: typeof fetch },
): Board {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const withEve: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    for (const [name, value] of Object.entries(eveHeaders(thread, await options.token(), options.bypass))) headers.set(name, value);
    return send(input, { ...init, headers });
  };
  return boardAt({ backend: http(BOARD, { fetch: withEve }) }).as({ name: eveName(thread), avatar: eveAvatar(thread) });
}

/** The sandbox's home, where clones and skills live. */
export const SANDBOX_HOME = `/home/${SANDBOX_USER}`;

/** A path as the model writes it: `~/…` and `$HOME/…` are in the sandbox's home, as Eve's file tools read them. */
export const sandboxPath = (path: string, home = SANDBOX_HOME) => path.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, home);

/** The sandbox's files, for --attach and download. */
export type SandboxFiles = {
  readBinaryFile(options: { path: string }): PromiseLike<Uint8Array | null>;
  writeBinaryFile(options: { path: string; content: Uint8Array }): PromiseLike<void>;
};

/** Runs a vb command as Eve, and says what it printed, as bash would: stdout, then stderr, then a failure's exit code. */
export async function runVb(board: Board, args: string[], files: () => Promise<SandboxFiles>): Promise<string> {
  const { code, stdout, stderr } = await vb(board, args, {
    readFile: async (path) => (await files()).readBinaryFile({ path: sandboxPath(path) }),
    writeFile: async (path, content) => (await files()).writeBinaryFile({ path: sandboxPath(path), content }),
  });
  return [stdout.trimEnd(), stderr.trimEnd(), code === 0 ? "" : `(exit ${code})`].filter(Boolean).join("\n") || "(no output)";
}
