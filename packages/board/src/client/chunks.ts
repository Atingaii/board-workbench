// A plan of tasks longer than one batch holds, made with the handle's own `tasks.createMany`, a
// batch at a time. Nothing here is a board's: it composes what any handle has.
import type { MessageView } from '../api/routes.ts'
import { TASK_BATCH_MAX } from '../contract/schemas.ts'
import { batchPlan } from '../contract/task-batch.ts'
import { BoardError, type TaskInBatch } from './client.ts'

/** What `createTasksInChunks` makes tasks with: a handle, or anything with its `tasks.createMany`. */
export type TaskBatches = { tasks: { createMany(channel: string, tasks: TaskInBatch[], opts?: { id?: string }): Promise<MessageView[]> } }

/**
 * A chunk failed, with the chunks before it made: `code`, `status`, and `message` are the failure's
 * own, and `created` holds the tasks that were made, each at its task's place in the `tasks` given,
 * with `undefined` for the ones that weren't.
 */
export class TasksInChunksError extends BoardError {
  readonly created: (MessageView | undefined)[]
  constructor(cause: unknown, created: (MessageView | undefined)[]) {
    const failed = cause instanceof BoardError ? cause : null
    super(failed?.code ?? 'chunk_failed', cause instanceof Error ? cause.message : String(cause), failed?.status ?? 0, {
      ...(failed?.hint !== undefined ? { hint: failed.hint } : {}),
      origin: failed?.origin ?? 'handle',
    })
    this.name = 'TasksInChunksError'
    this.cause = cause
    this.created = created
  }
}

/**
 * Makes `tasks` in `channel` with as many `tasks.createMany` calls as it takes, and answers their
 * roots in the order given. It makes each task after the ones it waits for by `key`, names a task
 * an earlier chunk made by the ID it got, and halves a chunk a board answers `batch_too_large`
 * for. With `id`, each chunk goes under an ID made from it and the chunk's place, so calling again
 * with the same `id` and tasks answers the chunks that landed and makes the rest.
 *
 * It isn't one write. Each chunk is all or nothing, and the chunks land one after another: a task
 * of an earlier chunk that's ready can be claimed before a later chunk lands. When a chunk fails
 * it stops and throws a `TasksInChunksError`, whose `created` has what the chunks before it made.
 * A plan that must not start early waits for a task of the caller's own, which it completes once
 * this returns.
 */
export async function createTasksInChunks(board: TaskBatches, channel: string, tasks: TaskInBatch[], options: { id?: string } = {}): Promise<MessageView[]> {
  const plan = batchPlan(tasks)
  // Tasks that can't be put in an order can't be made in parts: nothing is sent.
  if ('problem' in plan) throw new BoardError('invalid_needs', `needs: ${plan.problem}`, 400)
  const { order } = plan
  const places = new Map(tasks.flatMap((task, at) => (task.key !== undefined ? [[task.key, at] as const] : [])))
  const created: (MessageView | undefined)[] = tasks.map(() => undefined)
  let size = TASK_BATCH_MAX
  for (let from = 0; from < order.length; ) {
    const picked = order.slice(from, from + size)
    const chunk = picked.map((at): TaskInBatch => {
      const task = tasks[at]!
      if (!task.needs) return task
      // A task an earlier chunk made is there now, so it's named by its ID. One still to make is in this chunk, and is named by its key.
      return { ...task, needs: task.needs.map((need) => (typeof need === 'string' ? need : (created[places.get(need.key)!]?.id ?? need))) }
    })
    try {
      const made = await board.tasks.createMany(channel, chunk, options.id !== undefined ? { id: `${options.id}/${from}+${picked.length}` } : {})
      for (const [n, at] of picked.entries()) created[at] = made[n]
      from += picked.length
    } catch (error) {
      // More than this board holds in one write, and nothing was made: half of it, from the same place.
      if (error instanceof BoardError && error.code === 'batch_too_large' && picked.length > 1) size = Math.ceil(picked.length / 2)
      else throw new TasksInChunksError(error, created)
    }
  }
  return created as MessageView[]
}
