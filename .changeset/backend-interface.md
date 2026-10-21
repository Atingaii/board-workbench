---
'vboard': minor
---

`board()` serves the protocol over HTTP on every backend, and a backend is a plain object that answers it: one method per route, `(caller, input, signal)`, called with what the request said about its caller and the input the route's schema parsed. `board()` routes and validates requests, serves SSE, and runs watchers and sync. It does no auth: the backend verifies each request's credential, works out who it writes as, and decides what it may do. Write a backend of your own with `import { board, HttpError, type Backend } from 'vboard'` and the pieces in `vboard/access` (`verifyTokens()`, `resolveActor()`, `compileRules()`): the Mounting and Access pages show how, and `vb conformance` checks one against the whole protocol.

**Breaking:**

- `board()` takes `backend`, `watch`, `sync`, `url`, `basePath`, and `streamMaxMs`, and nothing else. `project`, `authenticate`, `access`, and `middleware` are `a2()`'s, where the log is.
- `auth` is gone: its options go to `verifyTokens()` from `vboard/access`, `a2()`'s default `authenticate`. `vb serve` passes `verifyTokens({ local })`, and tests `verifyTokens({ vercel, github, oidc })`.
- A request's `Caller` is `{ request: { credential, claims, audience, headers }, origin }`, none of it verified: the bearer token or null, what it claims for itself (`profile`, `avatar`, `session`, a person's `handle` and `name`, and `scope`), the board's URL, and its headers. The verified `identity` variant is gone. `Backend` has no `issuers`, `BackendRoute` has no `auth` (a route gets the same caller and checks it), and `BoardBinding` has no `project()` or `client()`: it has `readSource()`, `typing()`, and `handle()`.
- Discovery, typing, and source reads are protocol methods (`discovery`, `typing`, `readSource`), which a backend answers: `a2()` through the sync `board()` runs beside it.
- `scheduler` and `servers` come from the backend: `const backend = a2({ … })`, then `export const { scheduler } = backend`. What `board()` returns is the board's handle, whose `fetch` serves it.
- Discovery has no `capabilities`. Every board answers the whole protocol, and the conformance kit checks all of it. Its report has no `capabilities`.
- In production, `a2()` requires `store`, `scheduler`, and `blob`: a board missing one answers every request with 500 `not_configured`, naming what's missing. In development it runs a scheduler in its own process, so `vb serve` and a dev server send scheduled messages and retry failed deliveries with nothing else running.
- `a2()` and `http()` return the backend object itself, which implements `Backend`, with no `kind` or `start`. Each serves one `board()`.
- A profile a backend can't take fails the handle's first call, not `as()` itself.
- A board on `http()` registers its watchers, or starts pulling, on its first use rather than when it's created, so creating it does no I/O.

Options that moved, like `trustedSources` (now `a2({ access })`), aren't checked at runtime: TypeScript flags them.
