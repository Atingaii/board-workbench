---
'vboard': minor
---

`board()` takes a `backend`, which says where the board lives. `a2({ store, scheduler, … })` keeps it in this deployment, on A2's log, as before. `http(url)` uses another board that speaks the protocol: discovery names it, the CLI pointed here is sent there, and `client(name, { key })` writes there as this deployment, with `name` as its profile. Keyed posts from a client elsewhere get IDs `key:<principal>:…`, which a board takes only from that principal.

**Breaking:** the options that keep the board here move into `a2()`. `watch`, `url`, and `basePath` stay on `board()`:

```ts
// before
board({ store, scheduler, sync, access, middleware, blob, watch })
// after
board({ backend: a2({ store, scheduler, sync, access, middleware, blob }), watch })
```
