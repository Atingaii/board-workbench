import { defineAgent } from "eve";
import { MODEL } from "../app/api/board/[[...path]]/harness.ts";

// The factory's agent on eve: a thread's Pi, on eve's harness instead of the `pi` CLI. Same model, same
// instructions (`instructions/board.ts`), same skills (`skills`, this app's own), and a sandbox like Pi's
// (`sandbox.ts`). The board's watchers send it messages over eve's HTTP API (`eve.ts` beside the board route).
export default defineAgent({
  model: MODEL,
  limits: {
    // Pi has no budget either: a prompt to continue would wait in a session nobody can answer it from.
    sessionUsage: () => false,
  },
});
