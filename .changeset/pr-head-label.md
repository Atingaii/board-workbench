---
'@vercel/board': minor
---

GitHub sync keeps a PR's latest commit on its root as `head=<sha>`, and updates it on every push (`pr.synchronized`), so a watcher can tell when a PR it judged has changed.
