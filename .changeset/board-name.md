---
'@vercel/board': minor
---

`board({ name })` picks one of the team's boards in Vercel's API by its name, and `board({ team })` another team's: `{ name: 'security' }` is this team's board named security, `{ team: 'acme', name: 'security' }` team acme's, `{ team: 'acme' }` acme's default board, and neither is the team's default board, as before. `vercel()` looks the name up once, whatever its case. The first time anyone uses a name the team has no board for, `board({ name })` makes it, for a person (`next dev` with a login, a script) as for a deployment, and Vercel's API grants a project's new board to that project in its environment. `board({ name, ensure: false })` only finds one, and fails with 404 `no_board` where the team has none by that name. A name a board you can't see already has fails with 409 `board_name_taken`. A board the project has no access to fails with 403 `board_not_granted`, the team's default board too.

```ts
import { board } from '@vercel/board'
import { vercel } from '@vercel/board/backend-vercel'

const security = board({ backend: vercel(), name: 'security' })
const acme = board({ backend: vercel(), team: 'acme', name: 'security' })
```

`vb --name <board>` (or `BOARD_NAME`) picks it from the CLI, a name alone on `--scope`'s team. `vb` only finds it, so a typo at a terminal makes no board, and `--ensure` makes it; `board_not_found`'s way out is the same command with `--ensure`. `--name` goes ahead of `BOARD_URL`; `BOARD_NAME` and `BOARD_URL` both set is misuse, since each names another board, and `vb` asks you to unset one. `--scope` beside `--url` is misuse too: a board's URL names its team.

A backend of your own reads them once, as `binding.name` and `binding.team` in `bind` (each null when left out), and `binding.ensure`.
