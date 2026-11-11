import { defineDynamic } from "eve";
import { defineInstructions } from "eve/instructions";
import { threadOf } from "../lib/board";
import { NAME } from "../lib/identity";
import { INSTRUCTIONS } from "../lib/instructions";

// The instructions, with the thread the session is for.
export default defineDynamic((ctx) => {
  const thread = threadOf(ctx.session);
  if (!thread) return null;
  return defineInstructions({
    content: `${INSTRUCTIONS}\nOn the board you're ${NAME}, working on thread #${thread} only. Other threads have sessions of their own.`,
  });
});
