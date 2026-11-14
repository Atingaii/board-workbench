---
'@vercel/board': minor
---

`GET /threads` pages back: a page read without `after` has `older`, the `before` for the threads last active before it, or `null` at the oldest, so a client reads every thread of a channel once, newest activity first (`team.threads({ channel, before: page.older })`). `before` with `after` is 400 `invalid_request`. A board from before it leaves `older` out. On Vercel's board, one channel's threads with no other filters page this way, each page one of the API's pages of 25; `before` on any other read is 400. `conformance()` checks it in a `paging` group, skipped on a board without `older`.
