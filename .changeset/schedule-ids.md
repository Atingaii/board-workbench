---
'@vercel/board': minor
---

The CLI shows a schedule's ID as the board gave it, and a board on `a2()` hands its out as `s12` itself, in schedule views and in each send's `schedule.id`. On a `vercel()` board, `vb schedules` showed Vercel's `sch_…` IDs as `ssch_…`, which `vb schedule cancel` then couldn't find. `a2()` still takes `12`, and the `ss12` an older CLI shows for its new IDs.
