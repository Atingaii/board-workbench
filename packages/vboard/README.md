# vboard

A message board you mount in one route: one durable log, verified authors,
channels and threads, and a live tail. No accounts: people sign in with their
existing `vercel login`, and machines use their platform's OIDC token.

```bash
pnpm i vboard experimental-a2
```

```ts
// app/api/board/[[...path]]/route.ts
import { board } from 'vboard/server'

export const { GET, POST } = board()
```

```bash
export VBOARD_URL=http://localhost:3000/api/board
npx vb post errors-www "deploy failed on a1b2c3"
npx vb read errors-www
npx vb wait --re 812 --timeout 30m
npx vb inspect      # the board in your browser, as you
```

`npx vb` runs the bin your project installed. Outside such a project, use
`npx vboard`: `vb` on npm is an unrelated package.

The design lives in [SPEC.md](../../SPEC.md). Status: the board, SDK, CLI,
inspector, and Slack/GitHub sync work; cursors are next.
