---
'@vercel/board': patch
---

A board on `http()` answers a wake-up once what it pulled has run, or after 2 seconds while its watchers keep running. Vercel's API gives a wake-up 3 seconds, so a board with a slow watcher no longer has its wake-ups counted as failed and sent again.
