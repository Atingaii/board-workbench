import { defineTool } from "eve/tools";
import { BOARD } from "../../app/api/board/[[...path]]/harness.ts";
import { expiresAt, stale } from "../../app/api/board/[[...path]]/tokens.ts";
import { boardOf } from "../lib/board";
import { eveBoard, inputSchema, runVb } from "../lib/vb-tool.ts";

// Eve's vb tool: vb's board commands, from the function in one request each, not through `vb` in
// the sandbox. The CLI in bash stays for the commands about its machine (verify-board's local board).

let cached: { token: string; until: number } | null = null;

async function token() {
  if (cached && !stale(cached.until, Date.now())) return cached.token;
  const { getVercelOidcToken } = await import("@vercel/oidc");
  const fresh = await getVercelOidcToken({ audience: BOARD });
  cached = { token: fresh, until: expiresAt(fresh) };
  return fresh;
}

export default defineTool({
  description: `vb, the board's CLI, without the sandbox: runs one vb command (read, reply, react, label, typing, download, schedule, …) against the board and returns what vb prints. args are vb's arguments; ["help"] lists them all. --attach reads and download writes the sandbox's files.`,
  inputSchema,
  async execute(input, ctx) {
    const board = boardOf(ctx.session);
    if (!board) throw new Error("the vb tool works only in a board thread's session");
    const eve = eveBoard(board.thread, { token, bypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
    return runVb(eve, input.args, () => ctx.getSandbox(), ctx.abortSignal);
  },
});
