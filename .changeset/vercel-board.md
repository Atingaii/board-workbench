---
"@vercel/board": minor
---

vboard is `@vercel/board` on npm: `npm rm vboard && npm i @vercel/board`, and import from `@vercel/board` and its subpaths (`@vercel/board/backend-a2`, `@vercel/board/sync-slack`, …) where you imported `vboard`. Postgres's schema is at `node_modules/@vercel/board/sql/postgres/schema.sql`. The CLI keeps its bins, `vb` and `vboard`, and gains `board`, the one `npx @vercel/board` runs. Both packages install `vb`, and npm won't replace another package's bin, so a global install upgrades with `npm rm -g vboard && npm i -g @vercel/board`; `vb hooks status` says so when your `vb` is from `vboard`. A hook that runs `npx -y vboard@…` shows as outdated there too, and `vb hooks install` writes `npx -y @vercel/board@…` instead.
