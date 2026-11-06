---
'@vercel/board': minor
---

`@vercel/board/cli` has `inspect`, so `vercel board inspect` opens the board in your browser, as you. It loads only when it runs, and the inspector's page isn't bundled with it: an app that bundles board's CLI fetches the page that `INSPECTOR_PAGE` names (this version's `dist/inspect/app.js`, with its SHA-256) and hands it to `createApp` as `inspectorPage`. `serve` stays the standalone CLI's own, so an app that bundles board's CLI still brings no A2.
