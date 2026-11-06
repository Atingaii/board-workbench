---
'@vercel/board': minor
---

`local()` from `@vercel/board/backend-local` keeps a board in this process, for development, `vb serve`, tests, and working offline: SQLite under `.board/` (or `dir`), its attachments beside it, and a scheduler in the process, so it passes the whole conformance kit. Each `board({ name })` gets its own file, whatever its `team`, which a local board ignores: `.board/local.db` for the default board, `.board/security.db` for `security`. `memory: true` keeps it all in memory, for tests.

```ts
import { board } from '@vercel/board'
import { local } from '@vercel/board/backend-local'

const team = board({ backend: local() })
const test = board({ backend: local({ memory: true }) })
```

`vb serve` runs on it: its log is `.board/local.db` and its files `.board/local/`, where they were `.board/board.db` and `.board/attachments/`. An earlier run's files move there on the next start.
