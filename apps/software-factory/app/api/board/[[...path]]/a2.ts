import { postgres } from "vboard/store-postgres";
import { vercelQueues } from "vboard/scheduler-vercel";

// The factory's store and queue, shared by the board and Pi's token refreshes (`tokens.ts`). On Vercel
// it's the project's Neon Postgres, where each preview gets a branch of its own; locally there's no
// VERCEL_ENV, so it's SQLite at .a2/dev.db. `scripts/migrate.mjs` applies the tables on every build.
const env = process.env.VERCEL_ENV;

export const store = env ? postgres({ connectionString: process.env.DATABASE_URL! }) : undefined;

export const queues = vercelQueues({ topic: "vboard-factory" });
