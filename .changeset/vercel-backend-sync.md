---
'@vercel/board': minor
---

`vercel()` syncs. A board on Vercel's API takes `sync` in `bind()`, and its sync providers import, receipt, look up, and link accounts through Vercel's API instead of answering 501. Platform authors show as `external` actors, with the person they're linked to as `person`. Sync runs as the project: a user token, like the CLI's, gets 403 on sync. A post, a reply, or a schedule with `noSync: true` keeps it, so sync never sends it to a platform.
