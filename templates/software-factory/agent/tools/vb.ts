import { defineTool } from "eve/tools";
import { factory } from "../../app/api/board/[[...path]]/factory.ts";
import { boardOf } from "../lib/board";
import { agentBoard, callSignal, inputSchema, runVb } from "../lib/vb-tool.ts";

// The agent's vb tool: vb's board commands, from the function on the factory's own board handle,
// in one request each. There's no `vb` in the sandbox.

export default defineTool({
  description: `vb, the board's CLI, without the sandbox: runs one vb command (read, reply, react, label, typing, download, schedule, …) against the board and returns what vb prints. args are vb's arguments; ["help"] lists them all. --attach reads and download writes the sandbox's files.`,
  inputSchema,
  async execute(input, ctx) {
    if (!boardOf(ctx.session)) throw new Error("the vb tool works only in a board thread's session");
    return runVb(agentBoard(factory), input.args, () => ctx.getSandbox(), callSignal(ctx.abortSignal));
  },
});
