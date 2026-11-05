---
'@vercel/board': patch
---

`vb reply <id> "…" --label step=fix` labels the reply as it posts it, as `vb post <id> "…" --label …` already did. `reply` refused `--label` before.
