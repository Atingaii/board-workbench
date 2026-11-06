---
'@vercel/board': minor
---

`team.explain('security/incidents', { user: 'bob@acme.com' })` (`GET /grants/explain?channel=…&user=…`) says which grant decides a channel, and what it gives: `{ channel, pattern, level, grants, rule, capped, can }`, the pattern that won, the level that won there, the grants at that level (or the rule in code), and the result. Without a principal it explains the caller. Anyone else's takes `manage` at `*`, and so does seeing which grants decided. Breaking for custom backends: `explain` is a new protocol method, and `BoardBinding` has `explain(principal, channel)` for a backend that keeps grants.
