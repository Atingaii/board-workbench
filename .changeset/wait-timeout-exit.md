---
'@vercel/board': minor
---

Breaking for scripts: a `wait` (or `identity link`) that times out exits 1, not 124, as the Vercel CLI's waits do. Tell a timeout from another failure by its `reason`, `timeout`, in the `--json` error document.
