import { defineAgent } from "eve";
import { MODEL } from "../app/api/board/[[...path]]/harness.ts";

// Pi, the factory's agent: one per thread, with its instructions (`instructions/board.ts`), this app's skills
// (`skills`), and a sandbox with vb, gh and git (`sandbox.ts`). The board's watchers send it messages over eve's
// HTTP API (`eve.ts` beside the board route).
export default defineAgent({
  model: MODEL,
  limits: {
    // No budget: a prompt to continue would wait in a session nobody can answer it from.
    sessionUsage: () => false,
  },
});
