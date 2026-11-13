---
'@vercel/board': patch
---

On Vercel's board, `--mentions` finds messages that mention someone, on `vb read`, `vb tail`, `vb wait` and the handle's reads: you by your handle or actor ID with no name given, and anyone else by the name as written and what's under it, as on a local board. It matched nothing there, whatever the message said. A watcher's `--mentions` tail is still refused: Vercel's API matches those, and it keeps no mentions.
