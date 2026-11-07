---
'@vercel/board': minor
---

The header that narrows a token for one request is `x-board-can` now, not `x-board-scope`: its value is a `can`, written as `--can`, grants, tokens, and `/me` write theirs (`dev/=read,post;ci/=read`). This breaks a proxy that still sends `x-board-scope`, which the board now ignores, so its callers get the token's whole access: send `x-board-can` instead. Nothing we know of sent it, so the board doesn't read both. A header it can't parse is still 400 `invalid_scope`, with a message that names `x-board-can`.
