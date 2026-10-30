---
'@vercel/board': patch
---

`linear()` opens the thread of an issue the board hasn't seen on any edit to it, not only when it's created, so issues that predate the mirror (or moved into a mirrored team) come in the next time they're touched: bulk-editing a Linear view brings in all of its issues. Edits to issues already on the board still only update `state` and the title.
