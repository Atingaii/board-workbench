---
'@vercel/board': patch
---

A watcher is woken by the messages it scheduled itself. A watcher's own writes never wake it, and that covered what a schedule of its own posted too, so a watcher that scheduled "check on CI in 5 minutes" was never run on it. Now each send of a schedule wakes the watcher that made it, like anyone's post, on `local()` and for watchers run as tails; what it then writes on that message (a reaction, an edit, a label) still doesn't. On Vercel's board the match happens in Vercel's API, which follows: until it does, a deployment's watcher there isn't woken by its own scheduled sends, and neither is one by an agent writing under a profile named for it (`team.as('fix')` and a watcher `fix` are one actor).
