import { redisHttp } from "@vercel/board/backend-a2/store-redis-http";
import { vercelQueues } from "@vercel/board/backend-a2/scheduler-vercel";
import { vercelQueues as a2Queues } from "experimental-a2/scheduler-vercel";
import { redisHttp as a2RedisHttp } from "experimental-a2/store-redis-http";

// The factory's store and queue: A2's log and the board's tables on the project's Upstash, under one
// prefix. Locally there's no VERCEL_ENV, so it's SQLite at .a2/dev.db, loaded only there.
const env = process.env.VERCEL_ENV;

export const store = env
  ? redisHttp({
      url: process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!,
      // One Redis serves every environment: a preview never touches production's log.
      keyPrefix: env === "production" ? "board-factory" : `board-factory:${env}`,
    })
  : (await import("@vercel/board/backend-a2/store-sqlite")).sqlite();

export const queues = vercelQueues({ topic: "vboard-factory" });

// Pi's token refreshes (`tokens.ts`) run on an A2 of the factory's own, apart from the one inside the
// board: their own keys in the same Redis, their own queue topic and route (`app/api/a2/tokens`), and
// locally their own SQLite file.
export const tokensStore = env
  ? a2RedisHttp({
      url: process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!,
      keyPrefix: env === "production" ? "board-factory-tokens" : `board-factory-tokens:${env}`,
    })
  : (await import("experimental-a2/store-sqlite")).sqlite({ path: ".a2/tokens.db" });

export const tokensQueue = a2Queues({ topic: "vboard-factory-tokens" });
