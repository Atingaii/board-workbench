---
'@vercel/board': minor
---

`board()` with no backend uses your team's board in Vercel's API, the one `name` names, where it threw `no_board` without `BOARD_URL`. In Node it finds the team and credentials as the Vercel CLI and a deployment do (`VERCEL_TOKEN`, the deployment's OIDC token, then your `vercel login`), and with `BOARD_URL` set, it's the board at that URL, as before.

```ts
import { board } from '@vercel/board'

const team = board()                          // the team's default board
const security = board({ name: 'security' })  // its board named security
const acme = board({ team: 'acme' })          // team acme's default board
```

`board({ fetch })` sends the credentials Vercel's API takes in place of the environment's, so a browser reaches Vercel's board with credentials of its own. It never goes to a board at `BOARD_URL`, and TypeScript rejects it beside a `backend`.

`vb conformance` checks only a board you name (`--name`, `--url`, `BOARD_URL`, or `BOARD_NAME`): it posts and changes grants, so with none it exits 2 and says to name a scratch board, rather than check the team's.
