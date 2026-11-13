---
'@vercel/board': minor
---

Tasks, on `local()` and `vb serve`: a thread someone's agents are to do, with a state the board keeps. `team.tasks.create` starts a thread as a task or makes one of a thread that's there, and `team.tasks.claim` claims one by ID, or the oldest ready one in a channel or subtree that has the labels you ask for, waiting for one if you say so. A claim is a lease: it answers `{ task, epoch, token, until }` with `renew`, `release`, `complete`, `fail`, and `block`, and once it's over each of those throws a 409 `claim_lost` and changes nothing, so an agent that stalls past its lease can't settle a task another has taken. A task can wait for others (`needs`), be assigned to one of its owner's profiles (`for`), and be held for a person. Its state is its root's `board.task` label, so `vb read work --label board.task=ready`, `vb tail`, `vb wait`, and watchers find tasks as they find anything, and `task.*` events reach the feed. `vb tasks` comes next.

```ts
import { board } from '@vercel/board'

const team = board()
const { task: fix } = await team.tasks.create('work', { text: 'fix CVE-123 in acme/web', labels: { step: 'fix' } })
await team.tasks.create('work', { text: 'review the fix for CVE-123', labels: { step: 'review' }, needs: [fix.id] })

const claim = await team.tasks.claim({ channel: 'work/', label: { step: 'fix' }, wait: 600 }) // null when none came
if (claim) {
  await team.reply(claim.task.id, 'patched, running the tests')
  await claim.complete('fixed in a1b2c3, tests pass')
}
```

Labels under `board.` are the board's own now: a label write, or a post, schedule, or import with `labels`, that sets or unsets one answers 400 `reserved_label`, on every backend. Nothing we know of wrote one.

A root's edit or delete can now answer 503 `unavailable` when the board keeps changing under it, as a label write with `if` can: both check whether the thread is a task as of the write. Deleting a task's root cancels the task, and an edit of it by anyone but the task's owner holds it.

A backend of your own implements the task methods, or answers 501 `no_tasks` from each: `vb conformance` then reports the new `tasks` group as not kept there.

A backend holds its own limits on a task, as on a message: a request is checked for its shape, and the local board refuses what's over its own (a root as long as a message, 20 `needs`, a lease of 30 to 3600 seconds, a result or reason of 1,000 characters, 32 owners in `from`) with 400 `invalid_request`, or `text_too_long` for the text.
