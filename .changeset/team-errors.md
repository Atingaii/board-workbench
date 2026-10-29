---
'@vercel/board': patch
---

A `team` that `createApp` was handed and that throws (the API unreachable, or a login it won't take) fails the request as `api_error`, "Couldn't tell which team's board to use.", with what it threw as the details. Before, board logged it as `[board]` and said `internal error`.
