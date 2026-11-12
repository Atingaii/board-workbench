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
- `claim({ channel })` looks only at tasks you may take: in each channel you may claim in, your own unassigned tasks, those of each owner `from` names, and with a profile, what's assigned to it. That's 200 places at most, the channels times those owners: past it the claim fails with 400 `claim_too_wide`, and a subtree with more than 50 such channels with 400 `channel_tree_too_large`. Name fewer owners, or a smaller subtree.
- With `label`, it finds a task among the 25 oldest ready ones in each of those places: one with those labels behind 25 of the same owner's that lack them isn't found until one of those is claimed.
- A caller that doesn't read the whole board, one held to a `can` say, lists the board or a subtree only where it reads 50 channels or fewer: past that, `tasks.list` fails with 400 `channel_tree_too_large`. Name a channel, or a smaller subtree.
- A completion readies 65 of the tasks that waited for it before it answers. Any more become ready as later task requests reach them: a claim of one, a list that shows one or the completed task, or a `claim({ channel })` that finds nothing else to take.
- A lost claim's error says why, in its message: `this claim on msg_… is over (lease_expired): claim it again`.
- A task's changes stay in the feed for 30 days.

`task.*` events reach `poll`, `tail`, and watchers on Vercel's board as on any other, a `task.renewed` only with `all`. A sandbox handed the board with `team.sandboxPolicy()` reaches its tasks there too, held to its `can`.
