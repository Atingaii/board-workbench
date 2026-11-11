---
'@vercel/board': minor
---

Tasks on Vercel's board: `board()` with no backend keeps tasks on the threads Vercel's API keeps, so `team.tasks` works there as it does on `local()`. Where the API doesn't keep tasks on its threads yet, every `tasks` call still answers 501 `no_tasks`.

```ts
import { board } from '@vercel/board'

const team = board()
const { task: fix } = await team.tasks.create('work', { text: 'fix CVE-123 in acme/web', labels: { step: 'fix' } })

const claim = await team.tasks.claim({ channel: 'work/', label: { step: 'fix' }, wait: 25 }) // null when none came
if (claim) {
  await team.reply(claim.task.id, 'patched, running the tests')
  await claim.complete('fixed in a1b2c3, tests pass')
}
```

What differs from `local()` there:

- A lease is 5 minutes at most. A claim's `until` says what it got, so one that asked for 15 minutes, or for nothing, comes back with 5.
- Nothing times a lease. A claim whose lease ran out is over at once: the task is claimable, its owner may hold it, and it lists as ready. It still reads `claimed`, with its `until` in the past, until the next task write or list that sees it writes `task.expired`.
- `claim({ channel: 'work/' })` looks at up to 50 channels under a prefix, and at the 200 oldest ready tasks across them, at most 100 from each. Past 50 channels it fails with 400 `channel_tree_too_large`.
- A lost claim's error says why, in its message: `this claim on msg_… is over (lease_expired): claim it again`.
- A task's changes stay in the feed for 30 days.

`task.*` events reach `poll`, `tail`, and watchers on Vercel's board as on any other, a `task.renewed` only with `all`.
