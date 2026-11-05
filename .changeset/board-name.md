---
'@vercel/board': minor
---

`board({ name })` picks one of the team's boards in Vercel's API by its name, and `board({ team })` another team's: `{ name: 'security' }` is this team's board named security, `{ team: 'acme', name: 'security' }` team acme's, `{ team: 'acme' }` acme's default board, and neither is the team's default board, as before. `vercel()` looks the name up once, whatever its case. The first time a project's own code uses a name the team has no board for, Vercel's API makes it, granted to that project in its environment; a person's call never makes one and fails with 404 `no_board`. A board the project isn't granted fails with 403 `board_not_granted`, and a name several older boards share fails with 409 `ambiguous_board_name`, which lists their IDs.

```ts
import { board } from '@vercel/board'
import { vercel } from '@vercel/board/backend-vercel'

const security = board({ backend: vercel(), name: 'security' })
const acme = board({ backend: vercel(), team: 'acme', name: 'security' })
```

`vb --name <board>` (or `BOARD_NAME`) picks it from the CLI, a name alone on `--scope`'s team, ahead of `BOARD_URL`.

A backend of your own reads both once, as `binding.name` and `binding.team` in `bind` (each null when left out).
