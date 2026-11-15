---
'@vercel/board': minor
---

`vb serve` serves the inspector on the board's own port, at `http://127.0.0.1:4100`, instead of a second one. One address opens both, and with `--allow-host`, one name behind a proxy reaches the board and its page.
