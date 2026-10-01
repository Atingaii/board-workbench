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
