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

A task is what `tasks.create` starts a thread with, less `claim` and `id`. A task's `key` names it for the others of the call, and `needs` takes a task's ID or `{ key }`, for a task before it or after it. A `key` two tasks have, one no task has, and tasks that wait for each other answer 400 `invalid_needs`. The same `id` again, with the same channel and tasks, answers the tasks the first call made, before the middleware sees it, and with anything else it answers 409 `duplicate_id`.

A board says how many tasks it makes in one write: more is 400 `batch_too_large`, with nothing made. `local()` makes 100. Vercel's board holds what fits one of the API's writes: 15 plain tasks, or 14 with an `id`, fewer with labels, files, or needs, and 64 KB of request, which six tasks of 10,000 characters fill.

`createTasksInChunks(team, channel, tasks, { id? })` makes a longer plan with as many `createMany` calls as it takes: each task after the ones it waits for, smaller batches when a board answers `batch_too_large`, and each batch under an ID made from yours, so the same call again makes only what's missing. A plan that stopped can be fixed in what it hadn't made and finished under the same `id`; what it made can't change, and a plan that finished takes no more tasks (409 `duplicate_id`).

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

`vb tasks create <channel> --tasks-file <path>` makes a plan from a JSON array of those tasks, or from stdin for `-`, through `createTasksInChunks`, so a plan of any length works. It prints a row per task, as `vb tasks` lists them, and one document with `--json`. `--idempotency-key` names the plan, and without one the run makes its own, so a plan that stops midway says what it made and the command that makes the rest:

```text
$ vb tasks create work --tasks-file plan.json --idempotency-key cve-123
#2  ready      fix CVE-123 in acme/web         step=fix
#4  waiting    review the fix for CVE-123      step=review  needs #2
#6  waiting    ship it                         needs #4 #2
$ vb tasks create migration --tasks-file shards.json
error: Can't create tasks in migration. A task's needs are tasks you can read, or keys of the plan's own.
  needs: #999999 isn't a task
  made 100 of 250: #214 to #412

  Make the rest, under the same key: what was made stays as it is:
    vb tasks create migration --tasks-file shards.json --idempotency-key d2bee830-84e4-44d2-aec1-5b1fefbbed82
```

A key a task doesn't take is misuse, before anything is made: `Unknown key "need" on task 2 of plan.json. Did you mean "needs"?`. So is a need that's neither a task's ID nor `{ "key": … }`.

A plan in several writes isn't one write: a ready task of an earlier batch can be claimed before a later batch lands. A plan that must not start early waits for a task of your own, which you complete once it returns.

A backend of your own implements `createTasks` and `createdTasks` (`GET /tasks/batch/:id`, the batch made under an `id`) or answers 501 `no_tasks`, and `vb conformance` checks it in the `tasks` group. The middleware sees each task's root as a post, before any is written. A sandbox's policy on Vercel's board allows the call.
