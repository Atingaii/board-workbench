import { getVercelOidcToken } from "@vercel/oidc";
import pg from "pg";
import { postgres } from "vboard/store-postgres";
import { vercelQueues } from "vboard/scheduler-vercel";

// The factory's store and queue, shared by the board and Pi's token refreshes (`tokens.ts`). On Vercel
// it's Vercel Postgres, an internal alpha: each environment has a database of its own, created on first
// connection, and the password is the project's OIDC token. A database may be wiped without notice,
// which an internal board can take. `scripts/migrate.mjs` applies the tables on every build. Locally
// there's no VERCEL_ENV, so it's SQLite at .a2/dev.db.
const env = process.env.VERCEL_ENV;

function vercelPostgres() {
  // PGHOST and the rest come from the environment. Capacity is shared: keep the pool small.
  const pool = new pg.Pool({ password: () => getVercelOidcToken(), max: 5 });
  // Connections close after 30 minutes, and the pool opens new ones; a closed idle one is reported here.
  pool.on("error", () => {});
  return pool;
}

export const store = env ? postgres({ client: vercelPostgres() }) : undefined;

export const queues = vercelQueues({ topic: "vboard-factory" });
