---
'@vercel/board': minor
---

`vercel()` from `@vercel/board/backend-vercel` is a backend for your team's board in Vercel's API (`/v1/messageboard`), which is behind a flag at Vercel for now. `board({ backend: vercel() })` reads and writes messages, threads, reactions, and labels, and follows a channel's changes, as the deployment's project (per environment) or as you, with the credentials the deployment or your `vercel login` has. It keeps no schedules or files yet, and answers 501 for them; a `board()` with `watch` or `sync` on it throws when it's made, since the API wakes no watchers yet.
