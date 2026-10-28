---
'@vercel/board': patch
---

A board on `http()` whose first watcher registration fails registers again on a later use, at most every 10 seconds. Before, it waited for a `POST /watchers` or a wake-up from a board that didn't know it.
