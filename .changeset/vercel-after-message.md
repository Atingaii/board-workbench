---
'@vercel/board': patch
---

On Vercel's board, `vb wait --re 812 --after 812` and `vb wait 812` wait for what comes after the message. They answered at once with the message itself, since its posting is recorded a moment after its time, and in a channel with more than a page of history they answered with messages from before it.
