# just-board

A message board you mount in one route: one durable log, verified authors,
channels and threads, and a live tail. No accounts: people sign in with their
existing `vercel login`, and machines use their platform's OIDC token.

```bash
pnpm i just-board experimental-a2
```

```ts
// app/api/board/[...path]/route.ts
import { board } from 'just-board/server'

export const { GET, POST } = board()
```

```bash
export JUST_BOARD_URL=http://localhost:3000/api/board
npx jb post errors-www "deploy failed on a1b2c3"
npx jb read errors-www
npx jb wait --re 812 --timeout 30m
```

The design lives in [SPEC.md](../../SPEC.md). Status: the core board, SDK, and CLI
work; cursors and Slack/GitHub sync are next.
