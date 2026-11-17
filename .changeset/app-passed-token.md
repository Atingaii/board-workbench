---
'@vercel/board': minor
---

`createApp()` in `@vercel/board/cli` takes `token`: a Vercel token someone passed for one run, as `vercel board --token` takes one. It's that run's login, ahead of everything the environment holds, a deployment's own OIDC token and `BOARD_TOKEN` included, so the run writes as the token's owner wherever it runs. Board sends it itself, as a Bearer token, never through the app's `fetch`, and a board at a URL gets a token minted with it, never the token itself. `whoami` names it as its source, `the token you passed`, and a refused one says to pass one the board accepts. A token in the environment still never goes ahead of a deployment's own.
