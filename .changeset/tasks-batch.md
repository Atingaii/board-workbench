---
'@vercel/board': minor
---

Several tasks in one write: `team.tasks.createMany(channel, tasks, { id? })` starts a thread for each task, all of them or none, on `local()` and on Vercel's board. Nothing of the batch shows before all of it has landed.

```ts
import { board } from '@vercel/board'

const team = board()

const [fix, review] = await team.tasks.createMany(
  'work',
  [
    { key: 'fix', text: 'fix CVE-123 in acme/web', labels: { step: 'fix' } },
    { text: 'review the fix', labels: { step: 'review' }, needs: [{ key: 'fix' }] },
  ],
  { id: 'cve-123' },
)
// fix is ready, and review waits for it: review.task.needs is [fix.id]
```

A task is what `tasks.create` starts a thread with, less `claim` and `id`. A task's `key` names it for the others of the call, and `needs` takes a task's ID or `{ key }`, for a task before it or after it. A `key` two tasks have, one no task has, and tasks that wait for each other answer 400 `invalid_needs`. The same `id` again, with the same channel and tasks, answers the tasks the first call made, and with anything else it answers 409 `duplicate_id`.

A batch makes 100 tasks at most, and a board that holds fewer in one write says so the same way, with 400 `batch_too_large` and nothing made. `local()` holds all 100. Vercel's board holds what fits one of the API's writes: 15 plain tasks, or 14 with an `id`, fewer with labels, files, or needs, and 64 KB of request, which six tasks of 10,000 characters fill.

`createTasksInChunks(team, channel, tasks, { id? })` makes a longer plan with as many `createMany` calls as it takes: each task after the ones it waits for, a batch halved when a board answers `batch_too_large`, and each batch under an ID made from yours, so the same call again makes only what's missing.

```ts
import { board, createTasksInChunks, TasksInChunksError, type TaskInBatch } from '@vercel/board'

const team = board()
const plan: TaskInBatch[] = Array.from({ length: 400 }, (_, n) => ({
  key: `shard-${n}`,
  text: `migrate shard ${n}`,
  ...(n > 0 ? { needs: [{ key: `shard-${n - 1}` }] } : {}),
}))
try {
  const tasks = await createTasksInChunks(team, 'work', plan, { id: 'migration-7' })
} catch (error) {
  if (!(error instanceof TasksInChunksError)) throw error
  // What the batches before the one that failed made, each at its task's place in `plan`.
  console.log(error.code, error.created.filter(Boolean).length)
}
```

It isn't one write: a ready task of an earlier batch can be claimed before a later batch lands. A plan that must not start early waits for a task of your own, which you complete once it returns.

A backend of your own implements `createTasks` or answers 501 `no_tasks`, and `vb conformance` checks it in the `tasks` group. The middleware sees each task's root as a post, before any is written. A sandbox's policy on Vercel's board allows the call.
