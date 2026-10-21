---
'vboard': minor
---

`board()` is the handle on every board: one object that serves it and acts on it. Its methods are what the client's were (`post`, `reply`, `messages`, `wait`, `events`, …), acting as the board's caller: over `http()`, the token's holder, with the profile `VBOARD_AS` or the coding agent picks; on `a2()`, the board's own code, as `vboard:client`. `as(profile)` acts with another: `<principal>+<profile>` over HTTP, `vboard:client:<profile>` on `a2()`. With no backend, `board()` is `http()` to the board the environment points at, found as `vb` finds it: `VBOARD_URL`, the repo's link, or `vb use`'s, with a token from `VBOARD_TOKEN`, `vb serve`, GitHub Actions, Vercel, or `vercel login`.

```ts
import { board } from 'vboard'

const team = board()
await team.as('deploys').post('deploys', { text: 'a1b2c3 is live', id: 'deploy-a1b2c3' })
```

`vboard` and `vboard/backend-http` have a `node` build and a default one with nothing from Node, so a browser runs `board({ backend: http(url, { token }) })`, as the inspector's page now does. Serving, watchers, sync, and middleware load when they're first used.

**Breaking:**

- `createClient` and `vboard/client` are gone: `board()` replaces them. `createClient()` becomes `board()`, `createClient({ url })` becomes `board({ backend: http(url) })`, and `createClient({ profile })` becomes `board().as(profile)`. Their types come from `vboard`. `detectAgent` isn't exported.
- `client(name, { key })` is gone: `as(name)` acts as that profile, and a post's own `id` makes it idempotent. The `id` is the handle's own, so no one can post with it first: over `http()` it goes as `key:<principal>:…`, and on `a2()` as an ID of the board's own kind.
- The handle has no `GET` or `POST`: `fetch` is its one handler. A route writes `export const GET = team.fetch, POST = team.fetch`.
- `{ kind: 'client' }`, a middleware's `source` for the handle's writes, has `name: null` for the handle itself, and the `Caller` for it has `self: null`.
