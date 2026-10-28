---
'@vercel/board': minor
---

Breaking: `vb link`, `vb use`, and project links are gone. Neither the CLI nor `board()` in Node reads a checkout's `.board/config.json` or `~/.config/board/config.json` any more, so a repo you clone can't point your token, or `VERCEL_AUTOMATION_BYPASS_SECRET`, at a host it names. Pass `--url <url>` or set `BOARD_URL`. In a Vercel project (`.vercel/project.json`, or `VERCEL_ORG_ID`), `vb` with neither talks to its team's board in Vercel's API; anywhere else it says how to point it at one. `vb serve` no longer links the project: it prints the `--url` and `BOARD_URL` that reach it. `vb whoami` checks the board answers, so a team board's URL with a wrong board ID says so.
