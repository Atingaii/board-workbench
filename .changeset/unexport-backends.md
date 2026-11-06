---
'@vercel/board': minor
---

**Breaking:** `@vercel/board/backend-http` (`http()`) and `@vercel/board/backend-vercel` (`vercel()`) are no longer exported, nor are their types (`HttpBackend`, `HttpOptions`, `VercelBackend`, `VercelOptions`). `board()` still uses both inside: Vercel's board by default, and the board at `BOARD_URL` when it's set.

What to write instead:

- `board({ backend: vercel({ team }) })` is `board({ team })`, `vercel({ fetch })` is `board({ fetch })`, and a board by its ID is one by its name, `board({ name })`.
- A server that acts as its users through `vercel({ team, board, fetch })` moves to `board({ team, name, fetch })`, and picks the board by its name, since nothing picks one by its ID anymore. Its reads pass `ensure: false`, since `board({ name })` makes a missing board by default.
- `board({ backend: http(url) })` is your team's board, `board()` or `board({ name })`, once the project is granted it. For a board at a URL, `vb serve`'s say, set `BOARD_URL`.
