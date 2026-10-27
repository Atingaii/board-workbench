import { defineHook } from "eve/hooks";
import { boardOf } from "../lib/board";
import { give } from "../lib/credentials";

// Each turn starts with the sandbox's credentials in place (`lib/credentials.ts`).
export default defineHook({
  events: {
    async "turn.started"(_event, ctx) {
      const board = boardOf(ctx.session);
      if (board) await give(ctx, board);
    },
  },
});
