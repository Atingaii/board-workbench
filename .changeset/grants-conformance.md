---
'@vercel/board': minor
---

`conformance()` checks how grants combine, through `explain`: the most specific pattern decides, then the closest principal there, ties add up, `everyone` lets no one in, and a viewer only reads and reacts. It checks that an app is kept by its client ID, and every app as a group. It checks that changing a grant takes `manage` at its patterns, and that a token grants no one past its own `can`, even under a lock, and lets no one in where `everyone` gets more than it has. Every grant it makes is in `conformance/grants/`, the same for every run, so it leaves no channel behind; it revokes them all, and a revoke that fails fails the check. Two runs on one board at once see each other's grants, so run it on a scratch board. A board that looks names up needs real ones: pass `principals: { project, repository, viewer, app }`, none of them the run's own, which it refuses before it writes. Grants across teams are skipped, since they aren't specified yet.
