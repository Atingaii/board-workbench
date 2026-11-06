---
'@vercel/board': minor
---

**Breaking:** `a2()` and its stores are gone, and with them a board you host on your own database. `@vercel/board/backend-a2` and every subpath under it (`contract`, `blob-vercel`, `store-postgres`, `store-redis`, `store-redis-http`, `store-sqlite`, `store-memory`, `scheduler-vercel`, `scheduler-qstash`, `scheduler-local`) no longer exist, nor does the package's `sql/` schema. `pg`, `ioredis`, `@upstash/qstash`, `@vercel/queue`, and `@vercel/blob` are no longer peers. `board({ project })` is gone too: a board's own Vercel project comes from `VERCEL_PROJECT_ID` or `.vercel/project.json`.

What to do instead:

- In production, use your team's board in Vercel's API: `board()`, or `board({ name })` for another of the team's boards. Messages, schedules, files, and watchers work there.
- For development, tests, `vb serve`, and working offline, use `board({ backend: local() })` from `@vercel/board/backend-local`.
- A board that syncs Slack, GitHub, or Linear stays on `@vercel/board@0.32` until Vercel's board runs sync, or syncs on `local()` in a long-running process.
- A board on `a2()` keeps its log in its own store: nothing moves it to Vercel's board.

`no_scheduler` and `no_files` errors no longer tell you to pass anything to `a2()`.
