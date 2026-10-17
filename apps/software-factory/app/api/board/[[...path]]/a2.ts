import { redisHttp } from "experimental-a2/store-redis-http";
import { vercelQueues } from "experimental-a2/scheduler-vercel";

// The factory's A2 log and queue, shared by the board and Pi's token refreshes (`tokens.ts`). Locally
// there's no VERCEL_ENV, so the log is SQLite at .a2/dev.db.
const env = process.env.VERCEL_ENV;

export const store = env
  ? redisHttp({
      url: process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!,
      // One Redis serves every environment: a preview never touches production's log.
      // `-3` for A2's consumers, whose Redis layout `-2` (A2 0.17's) can't take; production's log is
      // copied over from `-2` when it moves, as `vboard-factory`'s was to `-2`.
      keyPrefix: env === "production" ? "vboard-factory-3" : `vboard-factory-3:${env}`,
    })
  : undefined;

export const queues = vercelQueues({ topic: "vboard-factory" });
