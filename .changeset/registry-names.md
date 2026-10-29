---
'@vercel/board': minor
---

Breaking: two options take the Vercel CLI's registry names, so `vb` and `vercel board` read the same. `--from` is `--source` (`vb read dev --source slack`), in a watcher's `tail` too (`tail: 'firehose --source slack'`), and `--id` is `--idempotency-key` (`vb post deploys "a1b2c3 is live" --idempotency-key deploy-a1b2c3`). A board on this release refuses a watcher whose tail still says `--from`. `createApp({ login, team })` takes the app's Vercel login, and the team it resolves (`--scope` still wins), as functions board asks only when a request needs them, so help, a typo, or misuse never refreshes a login or looks a team up. A login that throws fails the request, as `not_logged_in`: board never falls back to `vercel login`'s, which can be someone else's.
