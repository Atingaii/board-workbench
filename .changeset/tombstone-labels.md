---
'@vercel/board': patch
---

A deleted message drops its labels, so `vb read dev --label state=open` no longer finds a deleted root, or its replies by the root's labels. Before, a deleted task still matched its labels and looked open. On a team board in Vercel's API, which keeps a deleted message's labels, the board leaves them out of every read itself, for every message. On a board on `a2()`, it covers what's deleted from now on: a message deleted before keeps its labels in the board's tables. The conformance kit checks it.
