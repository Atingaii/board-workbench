---
'@vercel/board': patch
---

`vb(board, argv, { signal })` ends whichever command is running, its requests included, where it stopped only `tail` and `wait`: a call with `AbortSignal.timeout(…)` gets a deadline, and a request that hangs no longer holds every later call. A command it stops fails with `timeout` (1) for a timeout's signal and `canceled` (130) otherwise; a write it stopped says it may have landed.
