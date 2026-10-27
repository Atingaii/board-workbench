import { defineDynamic } from "eve";
import { defineInstructions } from "eve/instructions";
import { INSTRUCTIONS, piName } from "../../app/api/board/[[...path]]/harness.ts";
import { boardOf } from "../lib/board";

// Pi's instructions for the session's task, word for word, and which thread's agent it is.
export default defineDynamic((ctx) => {
  const board = boardOf(ctx.session);
  if (!board) return null;
  return defineInstructions({
    content: `${INSTRUCTIONS[board.task]}\nOn the board you're ${piName(board.thread)}: the agent for thread #${board.thread} only. Other threads have their own, with names of their own.`,
  });
});
