---
"vboard": minor
---

Every sync provider takes `filter`, which decides which board messages it gets: return false and the message stays on the board, backfills included. With it, Slack can leave out a PR's inline review threads.
