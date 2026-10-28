---
'@vercel/board': patch
---

`vb read` on a board that answers 404 for its own reason, as Vercel's API does for a team without the messageboard (`Messageboard is not enabled for this team.`), says what the board said, instead of that the board is older than the CLI. Only a board's own `no route` answer means it predates thread summaries.
