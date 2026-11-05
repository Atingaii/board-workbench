---
'@vercel/board': patch
---

`vb edit`, `delete`, `react`, and `label` say what they did, in a line (`deleted 812`), where they printed nothing unless asked for `--json`. Their `--json` output is as it was.
