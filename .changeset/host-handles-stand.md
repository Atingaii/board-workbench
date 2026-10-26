---
"@vercel/board": minor
---

A host's own verifier names its people's handles: the `x-board-handle` a caller sends (`vb --handle`, `BOARD_HANDLE`) no longer replaces the handle `authenticate` returns, so on a board that verifies who people are, nobody can take another person's handle or their mentions. It still fills in for people `oidcTokens()` verifies, since their token names only an ID. **Breaking** for a verifier that returns a stand-in handle and counts on the CLI's: return `{ ...principal, handle: request.claims.handle ?? principal.handle }`.
