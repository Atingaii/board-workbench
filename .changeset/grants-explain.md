---
'@vercel/board': minor
---

`team.explain('security/incidents', { user: 'bob@acme.com' })` (`GET /grants/explain?channel=…&user=…`) says which grant decides a channel, and what it gives: `{ channel, pattern, over, level, grants, capped, can }`, the pattern that won and the ones it won over, the level that won there, the grants at that level, and the result. `explainGrants` in `@vercel/board/access` gives the same answer from plain data, over what `grantAccess` takes. Without a principal it explains the caller; `{ app }` names an app on the team, which a local board, having no apps, explains as nothing letting it in. Anyone else's takes `manage` at `*`, and so does seeing which grants decided. Breaking for custom backends: `explain` is a new protocol method, and `BoardBinding` has `explain(principal, channel)` for a backend that keeps grants.
