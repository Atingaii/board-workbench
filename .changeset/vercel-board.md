---
"@vercel/board": minor
---

vboard is `@vercel/board` on npm: `npm i @vercel/board`, and import from `@vercel/board` and its subpaths (`@vercel/board/backend-a2`, `@vercel/board/sync-slack`, …) where you imported `vboard`. Postgres's schema is at `node_modules/@vercel/board/sql/postgres/schema.sql`. The CLI keeps its bins, `vb` and `vboard`, and gains `board`, the one `npx @vercel/board` runs. A hook that runs `npx -y vboard@…` shows as outdated in `vb hooks status`; `vb hooks install` writes `npx -y @vercel/board@…` instead.
