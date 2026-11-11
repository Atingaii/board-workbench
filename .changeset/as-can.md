---
'@vercel/board': minor
---

`as(profile, { can })` holds a handle to a `can`, as `sandboxPolicy()` holds a sandbox: the board enforces it on every backend, as it does `x-board-can` (the header goes with each request over `http()` and to Vercel's API; on `local()` the caller is narrowed the same way). Like any narrowed caller it's never the deployment's integration, so an agent's tool that runs `vb()` on `team.as('fixer', { can })` can't register watchers or read sync's records, whatever commands it runs. `can` takes any `Can` or the header's text; a narrowed handle's `as()` and `sandboxPolicy()` only narrow it further.

A caller narrowed with `x-board-can` reading the inbox on a board `local()` keeps now gets 403, as the docs say and Vercel's API does: it's one of sync's records.
