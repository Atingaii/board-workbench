---
"@vercel/board": minor
---

`POST /watchers` takes a `path` instead of a `url` on a board whose discovery says `wake_by_path`: that board wakes the caller's own Vercel project at the path, through its Deployment Protection, taking the project and environment from the caller's token, so a project can only register itself, and anyone else gets 403 `not_a_project`. A board on `http()` on Vercel registers its mount path there instead of its URL, from production, or from a preview with its `branch`, whose latest ready deployment is woken. `a2()` can't find a project's deployments, so it answers a path with 501 `no_wake_by_path`, and `vb conformance` checks a board does one or the other as its discovery says.
