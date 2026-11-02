---
'@vercel/board': minor
---

`vercel()` boards schedule messages: `schedule` posts a thread or a reply later through Vercel's API, once or on a repeat, `schedules` lists them by thread, channel, and creator, and `cancelSchedule` stops one. Each send posts as its creator and carries `schedule: { id, n }`, as on `a2()`. The callers a `vercel()` board serves now schedule, cancel, edit, and delete too, where their grants let them post: on Vercel's board they all write as its project, which owns what any of them wrote, so each may change what another wrote through it. A schedule can't carry files, or labels on a reply, yet (501 `not_supported`), and one whose team turned Messageboard off shows as `revoked`.
