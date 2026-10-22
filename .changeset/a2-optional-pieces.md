---
'vboard': minor
---

`a2({ store?, scheduler?, blob? })` reads nothing from the environment: a board on it is what you pass, the same in development, tests, and production. `vboard/backend-a2/scheduler-local` exports `localScheduler()`, a scheduler whose timers live in the process, for development, `vb serve`, tests, and long-running servers (never serverless functions), which `vb serve` uses.

```ts
import { a2, fsBlob } from 'vboard/backend-a2'
import { localScheduler } from 'vboard/backend-a2/scheduler-local'

// A dev server: SQLite at .a2/dev.db, timers in the process, and files in .a2/attachments.
const backend = a2({ scheduler: localScheduler(), blob: fsBlob() })
```

- **Without a store,** the board is SQLite at `.a2/dev.db` in the working directory, in every environment, which suits development and a single long-running server. Where that can't open, as on Vercel, whose deployments can't write there, every request answers 500 `no_store` (`can't open SQLite at .a2/dev.db: this filesystem isn't writable here, so pass a store to a2()`), and nothing stands in for it in memory: pass `postgres()`, `redis()`, or `redisHttp()`.
- **Without a scheduler,** the consumers (the tables, watchers, sync's deliveries and inbox) run in the request that wrote. A failure is retried on the next write, and so is a lease that ran out or a wake-up that didn't arrive, which is fine for a tool and not enough for a production board with watchers or sync. Scheduling answers 501 `no_scheduler` (`vb schedule` says ``error: this board has no scheduler: pass `scheduler` to `a2()` to send later``).
- **Without a blob store,** the board keeps no files: `POST /attachments`, a post, schedule, or import that carries files, and a download answer 501 `no_files` (``this board keeps no files: pass `blob` to `a2()` ``). Sync brings a platform's files over as links to where they live, one line each, and sends no files out.
- `vb conformance` and `vboard/conformance` report the schedules and attachments checks as skipped, `not kept here`, on a board that answers them 501, rather than failing.

**Breaking:**

- `a2()` no longer keeps a board in memory in tests, or answers 500 `not_configured` in production: with no store, it's SQLite at `.a2/dev.db` everywhere. Pass `memory()` from `vboard/backend-a2/store-memory` in tests.
- It no longer starts a scheduler in the process in development, or keeps files in `.a2/attachments` (development) or memory (tests) by default: pass `scheduler: localScheduler()` and `blob: fsBlob()` or `memoryBlob()` (from `vboard/backend-a2`) for what they had.
- A board without a blob store answers 501 `no_files`, not 400 `no_blob_store`, and the `no_scheduler` message is new.
- `BoardStore`'s `log` is required.
- On a board with no store, the backend's `servers`, `session`, and `store` are there once its first request has opened the store.
