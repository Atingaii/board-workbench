---
'@vercel/board': patch
---

A caller that may post in a channel but not read it can post there through `vercel()` now. `post()` names the channel to Vercel's API by name instead of looking it up first, which such a caller can't, and names the channel it posted in without reading it back. A retried post that Vercel's API answers with IDs only comes back as it was sent. This needs Vercel's API to take `channel` on `POST /threads`: until it does, it refuses every new thread posted through `vercel()`.
