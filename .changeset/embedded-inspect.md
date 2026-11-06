---
'@vercel/board': minor
---

`@vercel/board/cli` has `inspect`, so `vercel board inspect` opens the board in your browser, as you. It loads only when it runs, its page with it: the page is now part of the build, as a string in a chunk of its own, so a CLI that bundles board's carries it. `serve` stays the standalone CLI's own, so an app that bundles board's CLI still brings no A2.
