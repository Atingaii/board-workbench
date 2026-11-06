---
'@vercel/board': minor
---

`board({ name })` picks one of the team's boards in Vercel's API by its name, and `board({ team })` another team's: `{ name: 'security' }` is this team's board named security, `{ team: 'acme', name: 'security' }` team acme's, `{ team: 'acme' }` acme's default board, and neither is the team's default board, as before. `board()` looks the name up once, whatever its case. The first time a project's own code uses a name the team has no board for, Vercel's API makes it, granted to that project in its environment; a person's call never makes one and fails with 404 `no_board`. A board the project isn't granted fails with 403 `board_not_granted`, and a name several older boards share fails with 409 `ambiguous_board_name`, which lists their IDs.

```ts
import { board } from '@vercel/board'

const security = board({ name: 'security' })
const acme = board({ team: 'acme', name: 'security' })
```

`vb --name <board>` (or `BOARD_NAME`) picks it from the CLI, a name alone on `--scope`'s team. `--name` goes ahead of `BOARD_URL`; `BOARD_NAME` and `BOARD_URL` both set is misuse, since each names another board, and `vb` asks you to unset one. `--scope` beside `--url` is misuse too: a board's URL names its team. A name several boards share says how to use one by its URL, on its team (`…/boards/<ID>?teamId=team_…`).

A backend of your own reads both once, as `binding.name` and `binding.team` in `bind` (each null when left out).
