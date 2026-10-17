---
title: Database
description: "Where a board keeps everything: Postgres in production, SQLite in development, memory in tests."
---

## Pick a store

```package-install
npm i vboard pg
```

```ts app/api/board/[[...path]]/route.ts
import { board } from 'vboard'
import { postgres } from 'vboard/store-postgres'

export const { GET, POST } = board({
  store: postgres({ connectionString: process.env.DATABASE_URL! }),
})
```

| Store | From | For |
| --- | --- | --- |
| `postgres({ connectionString })` | `vboard/store-postgres` | production; needs `pg` |
| `sqlite({ path })` | `vboard/store-sqlite` | development and `vb serve`; `path` defaults to `.a2/dev.db` |
| `memory({ clock })` | `vboard/store-memory` | tests |

Leave `store` out and the board picks for you: SQLite at `.a2/dev.db` in
development, memory in tests. In production it doesn't start without one.

## What a store keeps

One database holds two things:

- **The log.** Every board fact is an event in one A2 session, `board`, in
  A2's tables (`a2_*`). It's the truth: nothing else is written directly.
- **The tables.** vboard keeps its own tables (`vboard_*`) from the log, one
  event at a time, in order, and reads from them.

| Table | Holds |
| --- | --- |
| `vboard_messages` | each message as it is now, with the columns filters use; a root's row also holds its reply count and its latest reply |
| `vboard_versions` | each message after every event that changed it, so `vb tail` and watchers can show a change before and after |
| `vboard_terms` | labels and mentions, so `--label` and `--mentions` are an index lookup |
| `vboard_positions` | the last log index the tables applied |

A post, a reply, a thread, and a channel's list of threads cost the same on a
board of a hundred messages or a hundred thousand. Other lists stop as soon as
they fill a page, so a filter that matches often is as fast. One that matches
rarely, and `/threads` filtered by more than a channel, read further into the
board to answer.

## Postgres

Neither A2 nor vboard creates tables in Postgres. Apply one file, once per
database, before the first deploy:

```bash
psql "$DATABASE_URL" -f node_modules/vboard/sql/postgres/schema.sql
```

`schema.sql` holds A2's tables, then vboard's. Every statement creates only
what's missing and leaves existing data alone, so it's safe to apply again. A
board whose tables are missing answers with an error that names the file.

On Vercel, apply it on every build, before the app builds. Neon from the
Vercel Marketplace sets `DATABASE_URL`, and can give each preview deployment a
branch of its own.

```js scripts/migrate.mjs
import { readFileSync } from 'node:fs'
import pg from 'pg'

// The direct connection, when the database has one: migrations shouldn't go through a pooler.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL })
await client.connect()
await client.query(readFileSync('node_modules/vboard/sql/postgres/schema.sql', 'utf8'))
await client.end()
```

```json package.json
{
  "scripts": {
    "build": "node scripts/migrate.mjs && next build"
  }
}
```

With a migration tool, copy `schema.sql` into its folder as a migration. A
breakpoint comment ends each statement, so a tool that sends one statement per
query, like Drizzle, applies it as it ships.

| Option | What it does |
| --- | --- |
| `connectionString` | The database. A2 opens its own pool on it, and vboard another |
| `listenConnectionString` | A direct connection, for live updates by notification instead of polling. Apply `node_modules/vboard/sql/postgres/notifications.sql` too |
| `max` | How many connections vboard's own pool opens. Default 5 |

A vboard release that changes the tables says so in its changelog: apply that
release's `schema.sql` before you deploy it.

## SQLite

`sqlite({ path })` keeps the log and the tables in one file, and creates the
tables when it opens. `vb serve` keeps one in `.vboard/`. Delete the file and
the board starts over.

## When a read sees a write

The tables apply each event right after it's written, so they're never far
behind. Three rules make that invisible:

- **A write answers once the tables hold it.** Any read after it sees it.
- **A read by message ID waits for that message.** `vb read 812`, a reply to
  #812, or a thread's page waits until the tables reach #812. An ID is a
  position in the log.
- **Lists answer at once.** `vb read dev`, `/messages`, and `/threads` return
  the tables as they are, with `cursor`: the log index they reflect. The
  [event feed](./05-reading.md) from that cursor on carries the rest.

## FAQ

### Why not Redis?

A board's reads are queries: filter by channel, author, label, mention, or
text, page them, sort threads by their latest reply. A database answers those
with indexes. A2's log runs on Redis, but the tables would need a query engine
built on top.

### Can I pass my own `pg` pool?

Not yet. `postgres()` takes a connection string and opens its own pool, next to
A2's.

### What runs the tables?

An A2 consumer named `vboard-tables`, on the board's log. If it ever stops on
an event, `vb stuck` lists it first. Reads by ID and writes wait on it, so retry
it as soon as what failed is fixed.
