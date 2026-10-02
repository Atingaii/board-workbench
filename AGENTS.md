# agents guide

vboard is one npm package (`packages/vboard`): the server (`board()`),
the client SDK, and the CLI (`vboard`, alias `vb`). [SPEC.md](./SPEC.md) is
the design; read it before changing behavior.

## run it

```bash
pnpm install
pnpm check          # build + typecheck + test
pnpm test           # vitest: unit, in-process server, and CLI end to end
```

Tests use A2's memory store and a local test issuer (`test/harness.ts`). Auth
runs real `jose` verification against an injected JWKS; there is no bypass.

## release it

A change people will notice gets a changeset (`pnpm changeset`). On `main`,
`.github/workflows/release.yml` opens a "Version Packages" PR; merging it
publishes `vboard` to npm by trusted publishing (OIDC, no token; no provenance
while the repo is private). The CLI and the API read their version from
`package.json`, so never edit `src/version.ts` to bump it.

## the software factory (`apps/software-factory`)

vboard running on itself: the board for `basehub-ai/vboard` PRs and BaseHub's
Slack. The app is only wiring: the board route holds the whole config, and the A2
scheduler route re-exports the board's `scheduler`. They're separate routes because
the queue trigger makes its function private.

```bash
cd apps/software-factory
vercel link --project vboard --scope basehub   # once; the board learns its project
pnpm dev                                       # the board at /api/board
VBOARD_URL=https://vboard-basehub.vercel.app/api/board pnpm exec vb inspect
```

- Every environment syncs with the real Slack and GitHub, so a local or preview
  board posts there too. `VERCEL_ENV` only picks the log: production's Redis keys,
  a preview's own keys in the same Redis, or SQLite at `.a2/dev.db` locally.
  Private Slack channels are mapped by ID: the Connect Slack app can't look them
  up by name.
- Watchers do the work. `triage` labels each firehose thread's `kind` with jev,
  judging the whole thread whenever a person posts. `pi` hands `kind=bug`
  threads to Pi (`agent.ts`) and tells it when someone replies; Pi reads what's
  new itself. Pi reproduces the bug, then opens a PR
  from a `pi/<thread>` branch, or labels the thread `reproduced=no` and says why.
- Pi runs the `pi` CLI (Opus 5.5 on AI Gateway) in one persistent Vercel Sandbox
  per thread, with `vb`, `gh`, and git. Its credentials are placeholders that
  the sandbox's network policy swaps for real ones on the way out, refreshed with
  every message. The policy also pins who Pi is on the board (profile `pi`,
  session `thread-<id>`), so watchers can tell a thread's Pi from everyone else. Its `vb` talks to the production board, the only one a sandbox
  can reach.
- The A2 scheduler route (`app/api/a2/scheduler`) is private to Vercel Queues
  (`vercel.json`). The board route must stay public: the CLI and webhooks call it.

## the inspector (`vb inspect`, `src/inspect/`)

A local web UI for any board, reading and writing as the CLI's identity. Check it
with `agent-browser` against `vb inspect --no-open`; try writes against a local
board (`apps/software-factory` with `pnpm dev`), since production syncs to Slack
and GitHub.

- **The page is just another SDK client.** `server.ts` serves the page, its
  bundle, and `/board/*`, a proxy that adds your credentials. The page needs no
  inspector-specific API; if it wants something, add it to the board's API.
- **State lives in `app/store.ts`, pure and tested.** Views merge by the log
  index they reflect (an older view never replaces a newer one); your writes are
  overlays until the stream confirms them. Components render from it.
- **The proxy acts as you, so it trusts nothing but its own page.** It binds
  127.0.0.1, rejects any `Host` that isn't its own (DNS rebinding), requires the
  per-run token on every `/board` request and the page's `Origin` on writes.
  Keep all of them.
- **The bundle is built** into `dist/inspect/app.js` by `tsdown` (React
  included). `pnpm test` builds first; running from source finds it in `dist`.
- **It's Just Chat's UI, ported.** Base UI (`@base-ui/react`) for menus,
  context menus, popovers, and autocompletes; lucide icons; plain CSS in
  `style.ts` with Just Chat's tokens. Right-clicking text keeps the browser's
  menu (`nativeMenu`); the row's space opens ours.
- **Just Chat's invariants hold:** the default cursor everywhere but text
  (buttons and sidebar links included), no smooth scrolling, hairlines only
  under headers, the thread pane's open state in the URL, typing anywhere
  focuses the composer, and live updates never move what you're reading or
  clobber what you're typing.

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
