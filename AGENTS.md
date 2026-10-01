# agents guide

just-board is one npm package (`packages/just-board`): the server (`board()`),
the client SDK, and the CLI (`just-board`, alias `jb`). [SPEC.md](./SPEC.md) is
the design; read it before changing behavior.

## run it

```bash
pnpm install
pnpm check          # typecheck + test + build
pnpm test           # vitest: unit, in-process server, and CLI end to end
```

Tests use A2's memory store and a local test issuer (`test/harness.ts`). Auth
runs real `jose` verification against an injected JWKS; there is no bypass.

## the software factory (`apps/software-factory`)

just-board running on itself: the board for `basehub-ai/just-board` PRs and BaseHub's
Slack, plus a local-only observer UI.

```bash
cd apps/software-factory
vercel link --project just-board --scope basehub   # once; the board learns its project
pnpm dev                                           # board at /api/board, observer at /
JUST_BOARD_URL=http://localhost:3000/api/board jb post firehose "hi"
```

- Wiring is in `lib/board.ts`. Slack and GitHub entries switch on when
  `SLACK_CONNECTOR` / `GITHUB_CONNECTOR` (Vercel Connect UIDs) are set.
- The observer pages 404 on Vercel. Locally they read the board through the Node
  SDK, so your Vercel login authenticates. `SOFTWARE_FACTORY_BOARD_URL` points
  them at the deployed board.
- The A2 scheduler route (`app/api/a2/scheduler`) is private to Vercel Queues
  (`vercel.json`). The board route must stay public: the CLI and webhooks call it.

## layering

API → SDK → CLI. The CLI makes no HTTP calls of its own; everything goes
through `createClient`. Request schemas live in `src/api/routes.ts` and are
shared by the server and the client.

## invariants

- **One log.** Every board fact is an event in A2 session `board`. Views are
  reducers in `src/contract/reducers.ts`. Bookkeeping that people don't read
  (cursors, raw platform events) belongs in side contracts, not the board log.
- **Folds mutate in place.** A2 clones state at every read and snapshot
  boundary, so an event costs O(1). Never share a fold's state object outside
  the fold.
- **Provenance is server-authored.** `by`, `mentions`, and sync fields are never
  read from a request body.
- **Erasable TypeScript only** (`erasableSyntaxOnly`): no parameter properties,
  enums, or namespaces. Tests run the CLI from source with Node's type stripping.
- **The CLI is a product surface.** Errors are one `error: …` line on stderr.
  Exit codes: 0 success, 1 error, 2 misuse, 124 when `wait` times out.
