---
'@vercel/board': patch
---

`vb read <link>` on a board older than reading links says so: `error: this board can't read links: update board where the board is deployed`. It failed with `error: replies is not iterable`, since an older board answers `/links` with its discovery document.
