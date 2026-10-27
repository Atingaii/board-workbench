import { localDev, vercelOidc } from "eve/channels/auth";
import { defaultEveAuth, eveChannel } from "eve/channels/eve";
import { boardFrom } from "../lib/board";

// Only this deployment's board watchers talk to the agent: `vercelOidc()` takes this project's own tokens and no
// one else's. Each message says which thread it's about; that goes into the turn's auth, where the sandbox's
// credentials (`hooks/credentials.ts`) and the instructions (`instructions/board.ts`) read it, and out of what the
// model sees.
export default eveChannel({
  auth: [vercelOidc(), localDev()],
  // A message waits for the turn before it; news piling up behind one turn joins into the next, as with Pi.
  turnPolicy: "queue",
  onMessage(ctx) {
    const auth = defaultEveAuth(ctx);
    const board = boardFrom(ctx.eve.clientContext);
    if (!auth || !board) return { auth, clientContext: [] };
    return {
      auth: { ...auth, attributes: { ...auth.attributes, boardTask: board.task, boardThread: board.thread } },
      clientContext: [],
    };
  },
});
