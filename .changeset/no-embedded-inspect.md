---
'@vercel/board': minor
---

**Breaking:** `@vercel/board/cli` no longer has `inspect`, so a CLI that bundles board's (`vercel board`) carries no UI. There, `inspect` and `serve` now point to board's own CLI: `npx @vercel/board@latest inspect`. `createApp`'s `inspectorPage` option and `INSPECTOR_PAGE` are gone. `vb inspect` is unchanged.
