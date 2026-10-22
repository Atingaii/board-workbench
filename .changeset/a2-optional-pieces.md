---
'vboard': minor
---

`a2({ store, scheduler?, blob? })` takes a store, and nothing from the environment: a board on it is what you pass, in development, tests, and production alike. `vboard/backend-a2/scheduler-local` exports `localScheduler()`, a scheduler whose timers live in the process, for development, `vb serve`, tests, and long-running servers (never serverless functions), which `vb serve` uses.

```ts
import { a2 } from 'vboard/backend-a2'
import { sqlite } from 'vboard/backend-a2/store-sqlite'
import { localScheduler } from 'vboard/backend-a2/scheduler-local'

const backend = a2({ store: sqlite(), scheduler: localScheduler() })
```

- **Without a scheduler,** the consumers (the tables, watchers, sync's deliveries and inbox) run in the request that wrote. A failure is retried on the next write, and so is a lease that ran out or a wake-up that didn't arrive, which is fine for a tool and not enough for a production board with watchers or sync. Scheduling answers 501 `no_scheduler` (`vb schedule` says ``error: this board has no scheduler: pass `scheduler` to `a2()` to send later``).
- **Without a blob store,** the board keeps no files: `POST /attachments`, a post, schedule, or import that carries files, and a download answer 501 `no_files` (``this board keeps no files: pass `blob` to `a2()` ``). Sync brings a platform's files over as links to where they live, one line each, and sends no files out.
- `vb conformance` and `vboard/conformance` report the schedules and attachments checks as skipped, `not kept here`, on a board that answers them 501, rather than failing.

**Breaking:**

- `store` is required. `a2()` no longer falls back to SQLite at `.a2/dev.db` in development or memory in tests, nor answers 500 `not_configured` in production: pass `sqlite()` from `vboard/backend-a2/store-sqlite` for a dev server, and `memory()` from `vboard/backend-a2/store-memory` in tests.
- `a2()` no longer starts a scheduler in the process in development, or keeps files in `.a2/attachments` or memory: pass `scheduler: localScheduler()` and `blob: fsBlob()` (from `vboard/backend-a2`) for what development had.
- A board without a blob store answers 501 `no_files`, not 400 `no_blob_store`, and the `no_scheduler` message is new.
- `BoardStore`'s `log` is required.

```ts
// a dev server, as development's defaults had it
board({ backend: a2({ store: sqlite(), scheduler: localScheduler(), blob: fsBlob() }) })
```
