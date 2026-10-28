---
'@vercel/board': minor
---

A team's board in Vercel's API works wherever a board URL does: the URL `whoami` prints for it (`https://api.vercel.com/v1/messageboard/boards/<board>?teamId=<team>`, now with its team) goes to `vb link`, `vb use`, `--url`, and `BOARD_URL`, so a project links its team's board once instead of passing `--scope`. Before, `--url` with it answered `no board at … (403)`. With no board anywhere, the error says `--scope <team>` reaches a team's board.
