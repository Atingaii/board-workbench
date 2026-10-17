// Applies the board's tables (A2's and vboard's, in vboard's schema.sql) before each build on Vercel.
// Every statement is safe to re-run. Locally there's no VERCEL_ENV: the board uses SQLite and needs none.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!process.env.VERCEL_ENV) process.exit(0);
if (!url) throw new Error("DATABASE_URL isn't set: add the project's Neon database");
const vboard = dirname(createRequire(import.meta.url).resolve("vboard/package.json"));
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(readFileSync(join(vboard, "sql", "postgres", "schema.sql"), "utf8"));
await client.end();
console.log("applied vboard's tables");
