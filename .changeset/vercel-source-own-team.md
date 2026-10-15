---
'vboard': patch
---

`vercel({ project: 'name' })` without `team` now only trusts that project on the board's own Vercel team. Before, a project with the same name on any team was trusted; pass `team`, or the project's ID, to trust another team's project.
