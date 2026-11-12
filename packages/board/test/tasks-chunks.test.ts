import { describe, expect, it } from 'vitest'
import type { MessageView } from '../src/api/routes.ts'
import { board, createTasksInChunks, TasksInChunksError, type TaskInBatch } from '../src/server/index.ts'
import { http } from '../src/backend-http/index.ts'
import { vercel } from '../src/backend-vercel/index.default.ts'
import { BOARD_URL, personToken, testBoard } from './harness.ts'
import { as, fakeMessageboard } from './messageboard.ts'
import { fakeQueue } from './queue.ts'

// createTasksInChunks: a plan longer than one batch holds, made with a handle's own tasks.createMany.

type Batch = { id?: string; tasks: { ref?: string; text: string; needs?: (string | { ref: string })[] }[] }

/**
 * A person's handle on a local board, every batch it sent, and `fail`: what a test sets to answer
 * the next batch request itself, in place of the board.
 */
function localTeam() {
  const kept = testBoard({ scheduler: fakeQueue().scheduler })
  const sent: Batch[] = []
  const front: { fail: ((request: Request, nth: number) => Response | null | Promise<Response | null>) | null } = { fail: null }
  const team = board({
    backend: http(BOARD_URL, {
      fetch: async (input, init) => {
        const request = new Request(input, init)
        request.headers.set('authorization', `Bearer ${await personToken('u_ada')}`)
        if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/tasks/batch')) {
          sent.push((await request.clone().json()) as Batch)
          const answered = await front.fail?.(request, sent.length)
          if (answered) return answered
        }
        return kept.fetch(request)
      },
    }),
  }).as(null)
  return { team, sent, front, kept }
}

/** A plan of `count` steps, each waiting for the one before it, and the first for the last of all: no order as given makes it. */
const steps = (count: number): TaskInBatch[] =>
  Array.from({ length: count }, (_, n) => ({ ref: `step-${n}`, text: `step ${n}`, ...(n > 1 ? { needs: [{ ref: `step-${n - 1}` }] } : n === 1 ? {} : { needs: [{ ref: `step-${count - 1}` }] }) }))

const all = async (team: ReturnType<typeof board>, channel = 'work'): Promise<MessageView[]> => {
  const found: MessageView[] = []
  for (let after: string | undefined; ; ) {
    const page = await team.tasks.list({ channel, state: 'all', limit: 500, ...(after !== undefined ? { after } : {}) })
    found.push(...page.tasks.map((task) => task.message))
    if (page.tasks.length < 500) return found
    after = page.cursor
  }
}

describe('createTasksInChunks', () => {
  it('makes a plan longer than a batch holds in as many batches as it takes: each task after the ones it waits for, and those an earlier batch made named by their IDs', async () => {
    const { team, sent } = localTeam()
    const plan = steps(230)
    const made = await createTasksInChunks(team, 'work', plan)
    // The tasks, in the order given, each waiting for the task its ref named, whichever batch made that one.
    expect(made.map((root) => root.text)).toEqual(plan.map((task) => task.text))
    expect(made.map((root) => root.task?.needs)).toEqual(made.map((_, n) => (n > 1 ? [made[n - 1]!.id] : n === 1 ? [] : [made[229]!.id])))
    expect(made.map((root) => root.task?.state)).toEqual(made.map((_, n) => (n === 1 ? 'ready' : 'waiting')))
    expect((await all(team)).map((root) => root.id).sort()).toEqual(made.map((root) => root.id).sort())
    // Three batches, none over what one holds. The first step waits for the last, so it's made last, after it.
    expect(sent.map((batch) => batch.tasks.length)).toEqual([100, 100, 30])
    expect([sent[0]!.tasks[0]!.text, sent[2]!.tasks.at(-1)!.text]).toEqual(['step 1', 'step 0'])
    // Within a batch a task names another by its ref; across batches, by the ID that one got.
    expect(sent[0]!.tasks[1]).toEqual({ ref: 'step-2', text: 'step 2', needs: [{ ref: 'step-1' }] })
    expect(sent[1]!.tasks[0]).toEqual({ ref: 'step-101', text: 'step 101', needs: [made[100]!.id] })
    expect(sent[2]!.tasks.at(-1)).toEqual({ ref: 'step-0', text: 'step 0', needs: [{ ref: 'step-229' }] })
    // A task waits for what was there by its ID, as it's given.
    const [after] = await createTasksInChunks(team, 'work', [{ text: 'after the plan', needs: [made[0]!.id] }])
    expect(after!.task).toMatchObject({ state: 'waiting', needs: [made[0]!.id] })
  })

  it("halves a batch a board says is more than it holds, as Vercel's does by what its tasks carry, and goes on from there", async () => {
    const api = fakeMessageboard()
    const sent: Batch[] = []
    const team = board({
      backend: vercel({
        team: 'team_test',
        api: 'http://localhost',
        files: api.files,
        fetch: async (input, init) => {
          const request = new Request(input, init)
          if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/tasks/batch')) sent.push((await request.clone().json()) as Batch)
          return as(api, 'user:u_jb')(input, init)
        },
      }),
    })
    const plan = steps(40)
    const made = await createTasksInChunks(team, 'plans', plan)
    expect(made.map((root) => root.text)).toEqual(plan.map((task) => task.text))
    expect(made.map((root) => root.task?.needs)).toEqual(made.map((_, n) => (n > 1 ? [made[n - 1]!.id] : n === 1 ? [] : [made[39]!.id])))
    // 40 and 20 were more than one of the API's writes holds: it made none of them, and took them ten at a time.
    expect(sent.map((batch) => batch.tasks.length)).toEqual([40, 20, 10, 10, 10, 10])
    expect((await team.tasks.list({ channel: 'plans', state: 'all', limit: 100 })).tasks).toHaveLength(40)
    // Long texts are more bytes than one of its requests holds before they're more than it counts: the same refusal, halved the same way.
    sent.length = 0
    const long: TaskInBatch[] = Array.from({ length: 12 }, (_, n) => ({ ref: `long-${n}`, text: `${n} ${'x'.repeat(9990)}`, ...(n > 0 ? { needs: [{ ref: `long-${n - 1}` }] } : {}) }))
    const texts = await createTasksInChunks(team, 'long', long)
    expect(texts.map((root) => root.text.length)).toEqual(long.map((task) => task.text.length))
    expect(texts.map((root) => root.task?.needs)).toEqual(texts.map((_, n) => (n > 0 ? [texts[n - 1]!.id] : [])))
    expect(sent.map((batch) => batch.tasks.length)).toEqual([12, 6, 6])
  })

  it("sends each batch under an id made from the caller's and its place, so calling again answers what landed and makes the rest", async () => {
    const { team, sent, front } = localTeam()
    const plan = steps(230)
    // The second batch never reaches the board: the first one landed, and the call fails with what it made.
    front.fail = (_request, nth) => (nth === 2 ? Response.json({ error: { code: 'unavailable', message: 'try again' } }, { status: 503 }) : null)
    const failed = await createTasksInChunks(team, 'work', plan, { id: 'release-42' }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(failed).toBeInstanceOf(TasksInChunksError)
    const { created, code, status, message } = failed as TasksInChunksError
    expect([code, status, message]).toEqual(['unavailable', 503, 'try again'])
    // What was made, at each task's own place among those given: steps 1 to 100, and neither step 0 nor the rest.
    expect(created).toHaveLength(230)
    expect(created.map((root) => root?.text)).toEqual(plan.map((task, n) => (n >= 1 && n <= 100 ? task.text : undefined)))
    expect((await all(team)).map((root) => root.id)).toEqual(created.slice(1, 101).map((root) => root!.id))
    // The same call again: the batch that landed is answered, not made again, and the rest are made.
    front.fail = null
    sent.length = 0
    const made = await createTasksInChunks(team, 'work', plan, { id: 'release-42' })
    expect(made.slice(1, 101).map((root) => root.id)).toEqual(created.slice(1, 101).map((root) => root!.id))
    expect(made.map((root) => root.task?.needs)).toEqual(made.map((_, n) => (n > 1 ? [made[n - 1]!.id] : n === 1 ? [] : [made[229]!.id])))
    expect(await all(team)).toHaveLength(230)
    expect(sent.map((batch) => batch.tasks.length)).toEqual([100, 100, 30])
    // And once more makes nothing: every batch is answered as it stands.
    expect((await createTasksInChunks(team, 'work', plan, { id: 'release-42' })).map((root) => root.id)).toEqual(made.map((root) => root.id))
    expect(await all(team)).toHaveLength(230)
    // Without an id each batch is new: the same plan again is as many tasks again.
    await createTasksInChunks(team, 'work', steps(3))
    await createTasksInChunks(team, 'work', steps(3))
    expect(await all(team)).toHaveLength(236)
  })

  it('stops at the first batch a board refuses, with what the batches before it made, and makes nothing of a plan it can not order', async () => {
    const { team, sent } = localTeam()
    // The 151st task waits for a task that isn't there: the board refuses its batch, whole.
    const plan: TaskInBatch[] = Array.from({ length: 230 }, (_, n) => ({ text: `step ${n}`, ...(n === 150 ? { needs: ['999999'] } : {}) }))
    const failed = await createTasksInChunks(team, 'work', plan).then(
      () => null,
      (error: unknown) => error as TasksInChunksError,
    )
    expect(failed).toMatchObject({ name: 'TasksInChunksError', code: 'invalid_needs', status: 400, message: "needs: #999999 isn't a task", origin: 'board' })
    expect(failed!.created.map((root) => root?.text)).toEqual(plan.map((task, n) => (n < 100 ? task.text : undefined)))
    expect((await all(team)).map((root) => root.text)).toEqual(plan.slice(0, 100).map((task) => task.text))
    expect(sent.map((batch) => batch.tasks.length)).toEqual([100, 100])
    // Tasks that can't be put in an order can't be made in parts: it says so itself, and sends nothing.
    sent.length = 0
    for (const [unordered, why] of [
      [[{ text: 'waits for no one here', needs: [{ ref: 'nobody' }] }], /no task of the batch goes by the ref "nobody"/],
      [[{ ref: 'a', text: 'one a' }, { ref: 'a', text: 'another a' }], /two tasks of the batch go by the ref "a"/],
      [[{ ref: 'x', text: 'x', needs: [{ ref: 'y' }] }, { ref: 'y', text: 'y', needs: [{ ref: 'x' }] }], /"x", "y" wait for each other/],
    ] as const)
      await expect(createTasksInChunks(team, 'elsewhere', [...steps(150), ...unordered] as TaskInBatch[])).rejects.toMatchObject({ name: 'BoardError', code: 'invalid_needs', status: 400, origin: 'handle', message: expect.stringMatching(why) })
    expect(sent).toEqual([])
    expect(await all(team, 'elsewhere')).toEqual([])
  })

  it('gives up on a task a board holds none of, rather than ask for it again', async () => {
    const { team, sent, front } = localTeam()
    front.fail = () => Response.json({ error: { code: 'batch_too_large', message: 'this board makes no batches' } }, { status: 400 })
    const failed = await createTasksInChunks(team, 'work', steps(5)).then(
      () => null,
      (error: unknown) => error as TasksInChunksError,
    )
    expect(failed).toMatchObject({ name: 'TasksInChunksError', code: 'batch_too_large', status: 400 })
    expect(failed!.created).toEqual([undefined, undefined, undefined, undefined, undefined])
    expect(sent.map((batch) => batch.tasks.length)).toEqual([5, 3, 2, 1])
  })

  it("is not one write: a ready task of an earlier batch can be claimed before a later batch lands, unless the plan waits for a task of the caller's own", async () => {
    const { team, front } = localTeam()
    const plan: TaskInBatch[] = Array.from({ length: 150 }, (_, n) => ({ text: `step ${n}` }))
    // Someone claims the next ready task there while the second batch is on its way.
    const taken: (string | null)[] = []
    front.fail = async (_request, nth) => {
      if (nth === 2) taken.push((await team.tasks.claim({ channel: 'work' }))?.task.text ?? null)
      return null
    }
    await createTasksInChunks(team, 'work', plan)
    expect(taken).toEqual(['step 0'])
    // A plan that must not start early waits for a task of its maker's, where no worker claims: nothing of it is ready until that completes.
    const { task: gate } = await team.tasks.create('plans', { text: 'the plan is being made' })
    front.fail = async (_request, nth) => {
      if (nth === 4) taken.push((await team.tasks.claim({ channel: 'gated' }))?.task.text ?? null)
      return null
    }
    const gated = await createTasksInChunks(team, 'gated', plan.map((task) => ({ ...task, needs: [gate.id] })))
    expect(taken).toEqual(['step 0', null])
    expect(gated.every((root) => root.task?.state === 'waiting')).toBe(true)
    await (await team.tasks.claim(gate.id)).complete('made')
    expect((await team.tasks.claim({ channel: 'gated' }))?.task.text).toBe('step 0')
  })
})
