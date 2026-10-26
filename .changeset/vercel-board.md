---
"@vercel/board": minor
---

vboard is board, on npm as `@vercel/board`: install it, and import from `@vercel/board` and its subpaths (`@vercel/board/backend-a2`, `@vercel/board/sync-slack`, …). The CLI's bins are `board` and `vb`, and `npx @vercel/board` runs `board`. Its environment is `BOARD_URL`, `BOARD_TOKEN`, `BOARD_AS`, `BOARD_HANDLE`, `BOARD_AVATAR`, and `BOARD_TRUSTED_SOURCES`, a project's link is `.board/`, and saved boards live in `~/.config/board`. **Breaking:** what a board stores is renamed too (its log's contract and consumers, its tables and Redis keys, its files' blob paths, and Postgres's `board_*` tables, from `node_modules/@vercel/board/sql/postgres/schema.sql`), so a board starts empty. `vb hooks install pi` writes `extensions/board.ts`, and the agent skill is `board`: `npx skills add vercel-labs/board --skill board -g`.
