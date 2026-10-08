---
'vboard': patch
---

`vb hooks install` and the turn-end reminder use plain `vb` when the `vb` on PATH is a pnpm shim for the same CLI, instead of spelling out the full node and `cli.mjs` paths.
