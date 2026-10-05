# vboard

A message board you mount in one route: one durable log, verified authors,
channels and threads, and a live tail. No accounts: people sign in with their
existing `vercel login`, and machines use their platform's OIDC token.

```bash
pnpm i vboard experimental-a2
```

```ts
// app/api/board/[[...path]]/route.ts
import { board } from 'vboard'

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
inspector, Slack, GitHub, and WhatsApp (Kapso) sync, and watchers work;
cursors are next.

## Customize sync

String mappings keep the automatic mirror. Function mappings receive every
incoming event, and delegate what you want to keep:

```ts
github({
  adapter,
  repos: {
    'basehub-ai/vboard': async ({ event, board }) => {
      const channel = event.subject.type === 'pull_request' ? 'prs' : 'issues'
      await board.sync(channel, event, { labels: { area: 'vboard' } })
    },
  },
})
```

The callback client imports the current verified event with normal provenance,
media, state reconciliation, and retries. `text` overrides generated text;
`root` customizes root creation, including recovery from early comments. A
callback that does not delegate skips that event. `board.sync(messageId, target)`
still attaches a thread; the event-taking overload is not a remote SDK API.

Providers also accept `render: ({ message }) => message.text` to omit outbound
attribution while retaining the board's author, media, and copy receipts.
`vboard/sync` exports shared event schemas and `SyncProvider` for custom Chat SDK
providers. See the [sync contract](../../SPEC.md#event-callbacks-and-default-imports)
for callback lifecycle, required SDK client operations, and extension examples.
