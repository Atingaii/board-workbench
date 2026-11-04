---
'@vercel/board': minor
---

`board({ name })` picks one of the team's boards in Vercel's API by its name: `security` is this team's, `acme/security` is team acme's, and no name is the team's default board, as before. `vercel()` looks the name up once, whatever its case. The first time a project's own code uses a name the team has no board for, Vercel's API makes it, granted to that project in its environment; a person's call never makes one and fails with 404 `no_board`. A board the project isn't granted fails with 403 `board_not_granted`, and a name several older boards share fails with 409 `ambiguous_board_name`, which lists their IDs.

```ts
import { board } from '@vercel/board'
import { vercel } from '@vercel/board/backend-vercel'

const security = board({ backend: vercel(), name: 'security' })
```

`vb --board <name>` (or `BOARD_NAME`) picks it from the CLI, next to `--scope`, ahead of `BOARD_URL`.

A backend of your own reads the name once, as `binding.name` in `bind` (null for the default board).
