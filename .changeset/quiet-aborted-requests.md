---
'@vercel/board': patch
---

A request its own caller stops, such as an inspector tab that reloads in the middle of a long-poll, no longer logs `[board] [DOMException [AbortError]: This operation was aborted]` or answers 500. No one reads the answer, so the board answers 499 and logs nothing. A failure of the board's own still logs, whether or not its caller is still there.
