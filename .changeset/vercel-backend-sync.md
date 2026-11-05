---
'@vercel/board': minor
---

`vercel()` syncs. A board on Vercel's API takes `sync` in `bind()`, and its sync providers import, receipt, and look up through Vercel's API instead of answering 501. Platform authors show as `external` actors. Sync runs as the project: a user token, like the CLI's, gets 403 on sync.
