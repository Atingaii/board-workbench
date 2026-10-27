---
'@vercel/board': minor
---

The CLI inside another one (`@vercel/board/cli`, as `vercel board`) talks to your team's board in Vercel's API when nothing points it at another: the linked project's team's (`.vercel/project.json`), or `VERCEL_ORG_ID`'s, or your login's default team's. `--scope <team>` (or `--team`) picks a team's board by its slug or ID, in `vb` too. `vercel()` takes a team's slug as well as its ID, and your login from `VERCEL_AUTH_TOKEN`, which the Vercel CLI sets for a CLI it runs, before `vercel login`.
