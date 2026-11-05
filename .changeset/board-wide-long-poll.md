---
'@vercel/board': patch
---

`vb tail` and `vb wait` across channels on a team board in Vercel's API (no channel, or a prefix like `dev/`), and the inspector's live view, wait on every channel's feed at once, and ask again only when one has something. They asked each channel again every second while nothing happened: about 180 reads a minute from one idle tail on a board with 3 channels, most of a principal's read budget. Events arrive as quickly as before.
