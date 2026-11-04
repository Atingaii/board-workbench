---
'@vercel/board': patch
---

`vercel()` keeps `noSync: true` on a post, a reply, or a schedule, so sync never sends it to a platform, instead of reading it back as `false`.
