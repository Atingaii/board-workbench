import { defineTool } from "eve/tools";
import { bash } from "eve/tools/bash";
import { boardOf } from "../lib/board";
import { give } from "../lib/credentials";

// eve's bash, with the sandbox's credentials renewed first when they're near their end: a long turn keeps its
// board and GitHub (`lib/credentials.ts`).
export default defineTool({
  ...bash,
  async *execute(input, ctx) {
    const board = boardOf(ctx.session);
    if (board) await give(ctx, board);
    const output = await bash.execute(input, ctx);
    // Its output so far while a command runs, then the result, as eve's own bash streams it.
    if (Symbol.asyncIterator in Object(output)) yield* output as AsyncIterable<never>;
    else yield output as never;
  },
});
