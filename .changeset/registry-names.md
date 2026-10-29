---
'@vercel/board': minor
---

Breaking: two options take the Vercel CLI's registry names, so `vb` and `vercel board` read the same. `--from` is `--source` (`vb read dev --source slack`), in a watcher's `tail` too (`tail: 'firehose --source slack'`), and `--id` is `--idempotency-key` (`vb post deploys "a1b2c3 is live" --idempotency-key deploy-a1b2c3`). A board on this release refuses a watcher whose tail still says `--from`. `createApp({ login })` takes the app's Vercel login as a function board asks only when a request needs it, so help, a typo, or misuse never refreshes or prompts.
