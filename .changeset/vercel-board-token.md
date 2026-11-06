---
'@vercel/board': patch
---

A board token in `BOARD_TOKEN` reaches a team's board in Vercel's API as `Authorization: Bearer <token>`, as it is, whatever its format, ahead of `VERCEL_TOKEN`, a deployment's OIDC token, and your Vercel login, as it does a board at a URL. `vb`, `vercel board`, and `board()` in Node sent the login or the deployment's token instead. `vb whoami` says `source  BOARD_TOKEN`.
