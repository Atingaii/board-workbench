import { defineTool } from "eve/tools";
import { BOARD } from "../../app/api/board/[[...path]]/harness.ts";
import { expiresAt, stale } from "../../app/api/board/[[...path]]/tokens.ts";
import { boardOf } from "../lib/board";
import { eveBoard, inputSchema, runBoard } from "../lib/vb-tool.ts";

// Eve's vb tool: the board calls it makes every turn, from the function in one request, not
// through `vb` in the sandbox. `vb` stays for the rest (download, schedule, verify-board).

let cached: { token: string; until: number } | null = null;

async function token() {
  if (cached && !stale(cached.until, Date.now())) return cached.token;
  const { getVercelOidcToken } = await import("@vercel/oidc");
  const fresh = await getVercelOidcToken({ audience: BOARD });
  cached = { token: fresh, until: expiresAt(fresh) };
  return fresh;
}

export default defineTool({
  description: `vb's read, reply, react, label and typing, in one call without the sandbox: read a thread (target #42, or a Slack or GitHub link) or a channel's threads (target dev, with text or label filters), reply (with attach for files in the sandbox), react, label, or show typing. It prints what vb would.`,
  inputSchema,
  async execute(input, ctx) {
    const board = boardOf(ctx.session);
    if (!board) throw new Error("the vb tool works only in a board thread's session");
    const eve = eveBoard(board.thread, { token, bypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
    const readFile = async (path: string) => (await ctx.getSandbox()).readBinaryFile({ path });
    return runBoard(eve, input, readFile);
  },
});
