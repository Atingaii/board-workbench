---
'@vercel/board': patch
---

On Vercel's board, a read that filters on what messages say or who wrote them (`--text`, `--by`, `--mentions`, `--source`) no longer reads a thread whose list already brought all of it: a post, or a post and one reply. It read every thread's messages, one request a thread, so `vb read archive --text osprey` over 40 posts was 48 requests and is 4.
