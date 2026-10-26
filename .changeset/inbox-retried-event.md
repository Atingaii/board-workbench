---
'@vercel/board': patch
---

A platform's retry of an event the board already has is taken as received, even when it reads differently the second time (another instance took it, or a name changed in between). It answered 500 `intake failed` with A2's `PARTIAL_DUPLICATE_BATCH`, so Slack kept retrying it.
