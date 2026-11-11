---
'@vercel/board': patch
---

`--by me` finds your own messages, threads and schedules on a local board (`vb serve`, `local()`), as it does on Vercel's board and as help says. It matched nothing there: `me` was looked up as a handle. As on Vercel's board, `me` is the caller alone: a person's `--by me` leaves out what their agents wrote, which `--by <handle>` covers.
