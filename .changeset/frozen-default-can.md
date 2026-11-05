---
'@vercel/board': patch
---

`DEFAULT_CAN` from `@vercel/board/access` is frozen, like `FULL_ACCESS`. Before, code that imported it and pushed onto it changed what every grant and token without a `can` gets on that board.
