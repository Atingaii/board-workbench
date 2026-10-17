// Applies the board's tables (A2's and vboard's, in vboard's schema.sql) before each build on Vercel.
// Every statement is safe to re-run. The database is Vercel Postgres (see `a2.ts`): its password is the
// project's OIDC token, and a new environment's database is created on first connection, so it retries
// until it's there. Locally there's no VERCEL_ENV: the board uses SQLite and needs none.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getVercelOidcToken } from "@vercel/oidc";
import pg from "pg";

if (!process.env.VERCEL_ENV) process.exit(0);
const vboard = dirname(createRequire(import.meta.url).resolve("vboard/package.json"));
const schema = readFileSync(join(vboard, "sql", "postgres", "schema.sql"), "utf8");
for (let attempt = 1; ; attempt++) {
  const client = new pg.Client({
    host: process.env.PGHOST ?? "vdb-demo.com",
    user: process.env.PGUSER ?? "postgres",
    database: process.env.PGDATABASE ?? "postgres",
    ssl: true,
    password: () => getVercelOidcToken(),
  });
  try {
    await client.connect();
    await client.query(schema);
    await client.end();
    break;
  } catch (error) {
    await client.end().catch(() => {});
    if (attempt >= 30 || !/being created/i.test(String(error?.message))) throw error;
    await new Promise((done) => setTimeout(done, 2000));
  }
}
console.log("applied vboard's tables");
