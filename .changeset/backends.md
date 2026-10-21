---
'vboard': minor
---

`board()` takes a `backend`, which says where the board lives. `a2({ store, scheduler, … })` keeps it in this deployment, on A2's log, as before. `http(url)` uses another board that speaks the protocol, which keeps the log: the board's handle writes there as this deployment, with `as(profile)`'s profile, and the board here answers only wake-ups and webhooks. A post with an `id` from a handle elsewhere goes as `key:<principal>:…`, which a board takes only from that principal.

**Breaking:** the options that keep the board here (`store`, `scheduler`, `blob`) move into `a2()`, and so do who may use it and what its writes go through (`project`, `authenticate`, `access`, `middleware`). What runs here on any backend stays on `board()`: `watch`, `sync`, `url`, `basePath`, `streamMaxMs`. The scheduler's callback comes from the backend:

```ts
// before
export const { GET, POST, scheduler } = board({ store, scheduler, sync, access, middleware, blob, watch })
// after
const backend = a2({ store, scheduler, blob, access, middleware })
const team = board({ backend, watch, sync })
export const GET = team.fetch, POST = team.fetch
export const { scheduler } = backend
```
