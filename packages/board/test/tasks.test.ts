import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardEventView, MessageView } from '../src/api/routes.ts'
import type { Can } from '../src/access/index.ts'
import type { Middleware, Watcher } from '../src/server/index.ts'
import type { BoardEvent } from '../src/contract/events.ts'
import { foldMessages, type MessagesState } from '../src/contract/folds.ts'
import { memory } from '../src/store/memory.ts'
import { http } from '../src/backend-http/index.ts'
import { board as projectBoard, BOARD_URL, caller, deploymentToken, personToken, testBoard, workflowToken } from './harness.ts'
import { fakeQueue } from './queue.ts'

const SECOND = 1000
const MINUTE = 60 * SECOND
const T0 = Date.parse('2026-10-07T12:00:00.000Z')
const at = (ms: number) => new Date(T0 + ms).toISOString()

const ADA = 'vercel:user:u_ada'
const BO = 'vercel:user:u_bo'
/** A deployment on the board's team: it reads, posts, and labels everywhere, and manages nothing. */
const WEB = 'vercel:project:prj_web:production'
/** acme/web's workflows: let in only where a test grants them. */
const CI = 'github:repo:123456'

type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>
type Team = ReturnType<typeof testBoard>

/** A caller with a fresh token each time, since some tests move the clock past a token's hour. */
const fresh =
  (handler: (request: Request) => Promise<Response>, token: () => Promise<string>, headers: Record<string, string> = {}): Call =>
  async (method, path, body) =>
    caller(handler, await token(), headers)(method, path, body)

const person = (board: Team, user: string, headers: Record<string, string> = {}) =>
  fresh(board.fetch, () => personToken(`u_${user}`), { 'x-board-handle': user, ...headers })
const web = (board: Team, headers: Record<string, string> = {}) => fresh(board.fetch, () => deploymentToken('web', 'prj_web', 'production'), headers)
const ci = (board: Team, headers: Record<string, string> = {}) => fresh(board.fetch, () => workflowToken(), headers)

/** Lets acme/web's workflows do what `can` says, and nothing else. */
const grantCi = (board: Team, can: Can) =>
  board.createGrant({ principals: [{ kind: 'github', repository: 'acme/web' }], can: (typeof can === 'object' && !Array.isArray(can) ? can : { '*': can }) as never })

function setup(options: Parameters<typeof testBoard>[0] = {}) {
  const queue = fakeQueue()
  const board = testBoard({ scheduler: queue.scheduler, ...options })
  /** Lets what the board does on its own (its tables, its timers) settle. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
  /** Moves the clock, then lets the queue deliver the timers that came due. */
  const advance = async (ms: number) => {
    await settle()
    vi.setSystemTime(Date.now() + ms)
    await queue.fire()
    await settle()
  }
  return { board, queue, advance, ada: person(board, 'ada'), bo: person(board, 'bo') }
}

/** A task in a thread of its own, as `call` makes it. */
async function task(call: Call, text: string, body: Record<string, unknown> = {}): Promise<MessageView> {
  const made = await call('POST', '/tasks', { channel: 'work', text, ...body })
  expect(made.status, JSON.stringify(made.body)).toBe(201)
  return made.body.task
}

/** A claim of task `id` by `call`: what the claim's own writes carry. */
async function claim(call: Call, id: string, body: Record<string, unknown> = {}): Promise<{ epoch: number; token: string; until: string }> {
  const claimed = await call('POST', `/tasks/${id}/claim`, body)
  expect(claimed.status, JSON.stringify(claimed.body)).toBe(200)
  return claimed.body.claim
}

const read = async (call: Call, id: string): Promise<MessageView> => (await call('GET', `/messages/${id}`)).body.message
const stateOf = async (call: Call, id: string) => (await read(call, id)).task?.state
/** Every board event after `after`, as the feed shows them with `all`. */
const events = async (call: Call, after: string | number = 0, query = ''): Promise<BoardEventView[]> => (await call('GET', `/events?after=${after}${query}`)).body.events
const types = (found: BoardEventView[]) => found.map((event) => event.type)
const code = (answer: { status: number; body: any }) => [answer.status, answer.body?.error?.code]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())

describe('a task', () => {
  it('is a thread: its root says what, wears its state as board.task, and reads like any message', async () => {
    const { ada, bo } = setup()
    const made = await ada('POST', '/tasks', { channel: 'work', text: 'fix CVE-123 in acme/web', labels: { step: 'fix' } })
    expect(made.status).toBe(201)
    const root = made.body.task as MessageView
    expect(root).toMatchObject({ channel: 'work', text: 'fix CVE-123 in acme/web', re: null, by: { actor: ADA }, labels: { step: 'fix', 'board.task': 'ready' } })
    expect(root.task).toEqual({ state: 'ready', owner: ADA, for: null, needs: [], epoch: 0, claim: null, blocked: null, result: null, reason: null })
    expect(made.body.claim).toBeUndefined()

    // Anyone who reads the channel reads it, replies in it, and finds it by its state.
    expect((await bo('POST', '/messages', { re: root.id, text: 'patched, running the tests' })).status).toBe(201)
    const thread = (await bo('GET', `/messages/${root.id}`)).body
    expect(thread.message.task).toEqual(root.task)
    expect(thread.replies.map((reply: MessageView) => reply.text)).toEqual(['patched, running the tests'])
    expect((await bo('GET', '/messages?channel=work&label=board.task=ready')).body.messages.map((m: MessageView) => m.id)).toContain(root.id)
    expect((await bo('GET', '/threads?label=board.task=ready&label=step=fix')).body.threads.map((t: { message: MessageView }) => t.message.id)).toEqual([root.id])
    expect((await bo('GET', '/messages?label=board.task=claimed')).body.messages).toEqual([])
  })

  it('can be a thread that was there: whoever makes it one owns it, and it stays as it was written', async () => {
    const { ada, bo } = setup()
    const issue = (await bo('POST', '/messages', { channel: 'issues', text: 'export times out past 10k rows', labels: { kind: 'bug' } })).body.message
    const reply = (await bo('POST', '/messages', { re: issue.id, text: 'still happening' })).body.message
    const made = await ada('POST', '/tasks', { re: issue.id })
    expect(made.status).toBe(201)
    expect(made.body.task).toMatchObject({ id: issue.id, text: 'export times out past 10k rows', by: { actor: BO }, labels: { kind: 'bug', 'board.task': 'ready' }, task: { state: 'ready', owner: ADA } })

    expect(code(await ada('POST', '/tasks', { re: issue.id }))).toEqual([409, 'already_a_task'])
    expect(code(await bo('POST', '/tasks', { re: issue.id }))).toEqual([409, 'already_a_task'])
    // A task is its thread's root, while it's there.
    expect(code(await ada('POST', '/tasks', { re: reply.id }))).toEqual([400, 'invalid_request'])
    expect(code(await ada('POST', '/tasks', { re: '999' }))).toEqual([404, 'message_not_found'])
    const gone = (await bo('POST', '/messages', { channel: 'issues', text: 'never mind' })).body.message
    await bo('POST', `/messages/${gone.id}/delete`, {})
    expect(code(await ada('POST', '/tasks', { re: gone.id }))).toEqual([400, 'message_deleted'])
    // `re` takes the thread as it is: its text and labels are its author's.
    expect(code(await ada('POST', '/tasks', { re: reply.id, text: 'mine now' }))).toEqual([400, 'invalid_request'])
    expect(code(await ada('POST', '/tasks', { channel: 'work' }))).toEqual([400, 'invalid_request'])
    expect(code(await ada('POST', '/tasks', { channel: 'work', re: issue.id, text: 'both' }))).toEqual([400, 'invalid_request'])
  })

  it('is made once for a client id, and a retry gets the task back without the claim it was made with', async () => {
    const { ada } = setup()
    const first = await ada('POST', '/tasks', { channel: 'work', text: 'deploy a1b2c3', id: 'deploy-a1b2c3', claim: true })
    expect(first.status).toBe(201)
    expect(first.body.claim).toMatchObject({ epoch: 1, until: at(15 * MINUTE) })
    const again = await ada('POST', '/tasks', { channel: 'work', text: 'deploy a1b2c3', id: 'deploy-a1b2c3', claim: true })
    expect(again.body.task.id).toBe(first.body.task.id)
    // The claim's secret was answered once: the task is still held by the claim that made it.
    expect(again.body.claim).toBeUndefined()
    expect(again.body.task.task).toMatchObject({ state: 'claimed', epoch: 1 })
    expect((await ada('GET', '/messages?channel=work')).body.messages).toHaveLength(1)
    // The claim it was made with still settles it.
    expect((await ada('POST', `/tasks/${first.body.task.id}/complete`, { epoch: 1, token: first.body.claim.token })).status).toBe(200)

    // An id a plain post took is that post's, not a task's.
    await ada('POST', '/messages', { channel: 'work', text: 'just a note', id: 'a-note' })
    expect(code(await ada('POST', '/tasks', { channel: 'work', text: 'just a note', id: 'a-note' }))).toEqual([409, 'duplicate_id'])
  })

  it('needs `post` to start a thread as one, `label` for its labels or to make a thread one, and `label` to claim', async () => {
    const { board, ada } = setup()
    await grantCi(board, { work: ['read', 'post'], triage: ['read', 'post', 'label'], audit: ['read'] })
    const runner = ci(board)
    // Posting is enough for a new thread: the board writes board.task itself.
    const made = await runner('POST', '/tasks', { channel: 'work', text: 'bump the lockfile' })
    expect(made.status).toBe(201)
    expect(made.body.task).toMatchObject({ labels: { 'board.task': 'ready' }, task: { owner: CI } })
    // Its labels need `label`, as a labeled post's do, and so does a claim made with it.
    expect(code(await runner('POST', '/tasks', { channel: 'work', text: 'labeled', labels: { step: 'fix' } }))).toEqual([403, 'forbidden'])
    expect(code(await runner('POST', '/tasks', { channel: 'work', text: 'claimed', claim: true }))).toEqual([403, 'forbidden'])
    expect((await runner('POST', '/tasks', { channel: 'triage', text: 'labeled', labels: { step: 'fix' }, claim: true })).status).toBe(201)
    expect(code(await runner('POST', '/tasks', { channel: 'audit', text: 'read-only here' }))).toEqual([403, 'forbidden'])
    expect(code(await runner('POST', '/tasks', { channel: 'elsewhere', text: 'no access here' }))).toEqual([403, 'forbidden'])
    expect((await ada('GET', '/messages?channel=work')).body.messages.map((m: MessageView) => m.text)).toEqual(['bump the lockfile'])

    // Making a thread a task changes its state, which is what `label` gives.
    const plain = (await ada('POST', '/messages', { channel: 'work', text: 'a thread' })).body.message
    expect(code(await runner('POST', '/tasks', { re: plain.id }))).toEqual([403, 'forbidden'])
    const hidden = (await ada('POST', '/messages', { channel: 'elsewhere', text: 'out of sight' })).body.message
    expect(code(await runner('POST', '/tasks', { re: hidden.id }))).toEqual([404, 'message_not_found'])

    // Without `label`, even its own task is not its to claim; where it has it, anyone's is.
    expect(code(await runner('POST', `/tasks/${made.body.task.id}/claim`, {}))).toEqual([403, 'forbidden'])
    expect(code(await runner('POST', '/tasks/claim', { channel: 'work' }))).toEqual([403, 'forbidden'])
    const theirs = await task(ada, 'triage the queue', { channel: 'triage' })
    expect((await runner('POST', `/tasks/${theirs.id}/claim`, {})).body.task.task).toMatchObject({ state: 'claimed', claim: { actor: CI } })
    // What it can't read isn't there.
    const secret = await task(ada, 'rotate the keys', { channel: 'elsewhere' })
    expect(code(await runner('POST', `/tasks/${secret.id}/claim`, {}))).toEqual([404, 'message_not_found'])
    expect(code(await runner('POST', `/tasks/${plain.id}/claim`, {}))).toEqual([404, 'not_a_task'])
  })
})

describe('a claim', () => {
  it('holds a task for its lease, and settles it: released, completed, or failed', async () => {
    const { ada, bo } = setup()
    const { id } = await task(ada, 'fix CVE-123')
    const held = await bo('POST', `/tasks/${id}/claim`, {})
    expect(held.status).toBe(200)
    // 15 minutes when it asks for none, as the claim and the task both say.
    expect(held.body.claim).toEqual({ epoch: 1, token: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), until: at(15 * MINUTE) })
    expect(held.body.task).toMatchObject({ labels: { 'board.task': 'claimed' }, task: { state: 'claimed', epoch: 1, claim: { actor: BO, session: null, until: at(15 * MINUTE) } } })
    const { epoch, token } = held.body.claim

    expect(code(await ada('POST', `/tasks/${id}/claim`, {}))).toEqual([409, 'task_claimed'])
    const released = await bo('POST', `/tasks/${id}/release`, { epoch, token })
    expect(released.body.task).toMatchObject({ labels: { 'board.task': 'ready' }, task: { state: 'ready', epoch: 1, claim: null } })

    const second = await claim(ada, id)
    expect(second.epoch).toBe(2)
    const failed = await ada('POST', `/tasks/${id}/fail`, { ...second, reason: 'the tests need a database' })
    expect(failed.body.task).toMatchObject({ labels: { 'board.task': 'failed' }, task: { state: 'failed', claim: null, reason: 'the tests need a database', result: null } })
    expect(code(await bo('POST', `/tasks/${id}/claim`, {}))).toEqual([409, 'task_finished'])
    // Reopened, it's tried again in place.
    expect((await ada('POST', `/tasks/${id}/reopen`)).body.task.task).toMatchObject({ state: 'ready', reason: null })

    const third = await claim(bo, id)
    const done = await bo('POST', `/tasks/${id}/complete`, { ...third, result: 'fixed in a1b2c3, tests pass' })
    expect(done.body.task).toMatchObject({ labels: { 'board.task': 'completed' }, task: { state: 'completed', epoch: 3, claim: null, result: 'fixed in a1b2c3, tests pass' } })
    expect(code(await ada('POST', `/tasks/${id}/claim`, {}))).toEqual([409, 'task_finished'])
    expect(code(await ada('POST', `/tasks/${id}/reopen`))).toEqual([409, 'task_finished'])
    // A result is optional, and a reason isn't.
    const quiet = await task(ada, 'tidy up')
    expect((await ada('POST', `/tasks/${quiet.id}/complete`, await claim(ada, quiet.id))).body.task.task).toMatchObject({ state: 'completed', result: null })
    const other = await task(ada, 'try it')
    expect(code(await ada('POST', `/tasks/${other.id}/fail`, await claim(ada, other.id)))).toEqual([400, 'invalid_request'])
  })

  it('lands once of any that race, and the rest are told it is claimed', async () => {
    const { ada, bo, board } = setup()
    const { id } = await task(ada, 'one for whoever gets there first')
    const racing = await Promise.all([ada, bo, web(board), ada, bo].map((call) => call('POST', `/tasks/${id}/claim`, {})))
    expect(racing.map(code).sort()).toEqual([[200, undefined], [409, 'task_claimed'], [409, 'task_claimed'], [409, 'task_claimed'], [409, 'task_claimed']])
    const won = racing.find((answer) => answer.status === 200)!
    expect(won.body.claim.epoch).toBe(1)
    // The log holds the one claim.
    expect(types(await events(ada)).filter((type) => type === 'task.claimed')).toHaveLength(1)
    expect((await read(ada, id)).task).toMatchObject({ epoch: 1, claim: { actor: won.body.task.task.claim.actor } })
  })

  it('is refused when another lands between its look at the task and its write', async () => {
    // A store where Bo's claim lands just before Ada's reaches the log, once.
    const store = memory()
    const append = store.log.append.bind(store.log)
    const state = { id: '', landed: false }
    let bo: Call | null = null
    store.log.append = async (session, appended, options) => {
      const claiming = appended.some((event) => event.type === 'task.claimed')
      if (claiming && !state.landed) {
        state.landed = true
        expect((await bo!('POST', `/tasks/${state.id}/claim`, {})).status).toBe(200)
      }
      return append(session, appended, options)
    }
    const board = testBoard({ store })
    const ada = person(board, 'ada')
    bo = person(board, 'bo')
    state.id = (await task(ada, 'one for whoever gets there first')).id
    expect(code(await ada('POST', `/tasks/${state.id}/claim`, {}))).toEqual([409, 'task_claimed'])
    expect(state.landed).toBe(true)
    expect((await read(ada, state.id)).task).toMatchObject({ epoch: 1, claim: { actor: BO } })
  })

  it('takes a lease of 30 seconds to an hour, says when it ends, and renews from now', async () => {
    const { ada } = setup()
    const { id } = await task(ada, 'a long build')
    for (const lease of [29, 3601, -1, '5m']) expect(code(await ada('POST', `/tasks/${id}/claim`, { lease })), String(lease)).toEqual([400, 'invalid_request'])
    const held = await claim(ada, id, { lease: 30 })
    expect(held.until).toBe(at(30 * SECOND))
    vi.setSystemTime(T0 + 20 * SECOND)
    const renewed = await ada('POST', `/tasks/${id}/renew`, { epoch: held.epoch, token: held.token, lease: 3600 })
    expect(renewed.body).toMatchObject({ until: at(20 * SECOND + 60 * MINUTE), task: { task: { state: 'claimed', epoch: 1, claim: { until: at(20 * SECOND + 60 * MINUTE) } } } })
    // Without one, a renewal gets the default again.
    expect((await ada('POST', `/tasks/${id}/renew`, { epoch: held.epoch, token: held.token })).body.until).toBe(at(20 * SECOND + 15 * MINUTE))
    expect(code(await ada('POST', `/tasks/${id}/renew`, { epoch: held.epoch, token: held.token, lease: 7200 }))).toEqual([400, 'invalid_request'])
  })

  it('fences what it does: once another claim holds the task, its writes are lost and change nothing', async () => {
    const { ada, bo } = setup()
    const { id } = await task(ada, 'migrate the table')
    const stalled = await claim(ada, id, { lease: 30 })
    // The wrong secret, or another epoch, is no claim at all.
    expect(code(await ada('POST', `/tasks/${id}/complete`, { epoch: stalled.epoch, token: 'not-the-token' }))).toEqual([409, 'claim_lost'])
    expect(code(await ada('POST', `/tasks/${id}/complete`, { epoch: 2, token: stalled.token }))).toEqual([409, 'claim_lost'])
    expect(await stateOf(ada, id)).toBe('claimed')

    // Ada stalls past her lease, and Bo takes the task over.
    vi.setSystemTime(T0 + 31 * SECOND)
    const before = (await ada('GET', '/events')).body.cursor
    const taken = await claim(bo, id)
    expect(taken.epoch).toBe(2)
    // The log says what happened to the first claim, in the same write as the second.
    expect((await events(ada, before)).map((event) => [event.type, (event.payload as { epoch: number }).epoch])).toEqual([['task.expired', 1], ['task.claimed', 2]])

    const head = (await ada('GET', '/events')).body.cursor
    for (const [verb, body] of [
      ['complete', { result: 'done, I think' }],
      ['fail', { reason: 'gave up' }],
      ['release', {}],
      ['renew', {}],
      ['block', { reason: 'approve?' }],
    ] as const)
      expect(code(await ada('POST', `/tasks/${id}/${verb}`, { epoch: stalled.epoch, token: stalled.token, ...body })), verb).toEqual([409, 'claim_lost'])
    // Nothing landed, and Bo still holds it.
    expect((await ada('GET', '/events')).body.cursor).toBe(head)
    expect((await read(ada, id)).task).toMatchObject({ state: 'claimed', epoch: 2, claim: { actor: BO }, result: null })
    // Even Bo's secret doesn't work at Ada's epoch, nor after Bo lets go.
    expect(code(await bo('POST', `/tasks/${id}/complete`, { epoch: 1, token: taken.token }))).toEqual([409, 'claim_lost'])
    expect((await bo('POST', `/tasks/${id}/release`, taken)).status).toBe(200)
    expect(code(await bo('POST', `/tasks/${id}/complete`, taken))).toEqual([409, 'claim_lost'])
    expect(await stateOf(ada, id)).toBe('ready')
  })

  it("is over when its lease runs out, even before anyone takes the task: its own write is lost", async () => {
    const { ada } = setup({ scheduler: undefined })
    const { id } = await task(ada, 'a short one')
    const held = await claim(ada, id, { lease: 30 })
    vi.setSystemTime(T0 + 29 * SECOND)
    expect((await ada('POST', `/tasks/${id}/renew`, { epoch: held.epoch, token: held.token, lease: 30 })).status).toBe(200)
    vi.setSystemTime(T0 + 59 * SECOND)
    expect(code(await ada('POST', `/tasks/${id}/complete`, { epoch: held.epoch, token: held.token }))).toEqual([409, 'claim_lost'])
    expect((await read(ada, id)).task).toMatchObject({ state: 'claimed', result: null })
  })

  it("expires when its lease runs out, on the board's own clock, unless it was renewed", async () => {
    const { ada, bo, advance } = setup()
    const { id } = await task(ada, 'watch the canary')
    const held = await claim(ada, id)
    await advance(10 * MINUTE)
    expect((await ada('POST', `/tasks/${id}/renew`, { epoch: held.epoch, token: held.token })).body.until).toBe(at(25 * MINUTE))
    // The first lease's timer fires into a claim that was renewed since: nothing happens.
    await advance(5 * MINUTE)
    expect((await read(bo, id)).task).toMatchObject({ state: 'claimed', claim: { until: at(25 * MINUTE) } })
    const before = (await ada('GET', '/events')).body.cursor
    await advance(10 * MINUTE)
    // The board says so itself: the task is ready, and its label with it.
    expect(await read(bo, id)).toMatchObject({ labels: { 'board.task': 'ready' }, task: { state: 'ready', epoch: 1, claim: null } })
    expect((await events(bo, before)).map((event) => [event.type, event.payload])).toEqual([['task.expired', { id, thread: expect.any(String), epoch: 1 }]])
    expect(code(await ada('POST', `/tasks/${id}/complete`, { epoch: held.epoch, token: held.token }))).toEqual([409, 'claim_lost'])
    // A claim settled before its lease ran out leaves its timer nothing to do.
    const next = await claim(bo, id)
    await bo('POST', `/tasks/${id}/complete`, next)
    const settled = (await ada('GET', '/events')).body.cursor
    await advance(20 * MINUTE)
    expect(await events(bo, settled)).toEqual([])
    expect(await stateOf(bo, id)).toBe('completed')
  })

  it('checks the clock where the board has no timers: a lapsed claim is ready to whoever asks', async () => {
    const { ada, bo } = setup({ scheduler: undefined })
    const { id } = await task(ada, 'a job on a board without a scheduler')
    await claim(ada, id, { lease: 60 })
    expect((await bo('GET', '/tasks?state=ready')).body.tasks).toEqual([])
    expect((await bo('GET', '/tasks?state=claimed')).body.tasks.map((t: { message: MessageView }) => t.message.id)).toEqual([id])
    vi.setSystemTime(T0 + 61 * SECOND)
    // Nothing told the label yet, and the task is ready all the same.
    expect((await read(bo, id)).labels['board.task']).toBe('claimed')
    expect((await bo('GET', '/tasks?state=ready')).body.tasks.map((t: { message: MessageView }) => t.message.id)).toEqual([id])
    expect((await bo('GET', '/tasks?state=claimed')).body.tasks).toEqual([])
    const taken = await ada('POST', '/tasks/claim', { channel: 'work' })
    expect(taken.body).toMatchObject({ task: { id, task: { state: 'claimed', epoch: 2 } }, claim: { epoch: 2 } })
  })
})

describe('a task that needs others', () => {
  it('waits until each has completed, and is ready in the same write as the last', async () => {
    const { ada, bo } = setup()
    const fix = await task(ada, 'fix CVE-123')
    const docs = await task(ada, 'write the advisory', { channel: 'docs' })
    const review = await task(ada, 'review both', { needs: [fix.id, docs.id, fix.id] })
    expect(review).toMatchObject({ labels: { 'board.task': 'waiting' }, task: { state: 'waiting', needs: [fix.id, docs.id] } })
    expect(code(await bo('POST', `/tasks/${review.id}/claim`, {}))).toEqual([409, 'task_waiting'])
    expect(code(await ada('POST', '/tasks', { channel: 'work', text: 'ship it', needs: [review.id], claim: true }))).toEqual([409, 'task_waiting'])

    await bo('POST', `/tasks/${fix.id}/complete`, await claim(bo, fix.id))
    expect(await stateOf(ada, review.id)).toBe('waiting')
    const before = (await ada('GET', '/events')).body.cursor
    await bo('POST', `/tasks/${docs.id}/complete`, await claim(bo, docs.id))
    // One append: the completion, then what it readied, with nothing in between.
    const landed = await events(ada, before)
    expect(landed.map((event) => [event.type, event.message?.id])).toEqual([['task.claimed', docs.id], ['task.completed', docs.id], ['task.ready', review.id]])
    expect(Number(landed[2]!.cursor)).toBe(Number(landed[1]!.cursor) + 1)
    expect(await read(ada, review.id)).toMatchObject({ labels: { 'board.task': 'ready' }, task: { state: 'ready' } })
    expect((await bo('POST', `/tasks/${review.id}/claim`, {})).status).toBe(200)

    // One whose prerequisites completed already is ready from the start.
    expect(await task(ada, 'announce it', { needs: [fix.id, docs.id] })).toMatchObject({ labels: { 'board.task': 'ready' }, task: { state: 'ready', needs: [fix.id, docs.id] } })
  })

  it('answers a completion that readies another in a script with nothing else running', async () => {
    // local()'s timers don't keep a process alive, so a write that waited on the board's own
    // background work would leave a short script to exit before it answered, with nothing printed.
    const from = (path: string) => JSON.stringify(pathToFileURL(join(import.meta.dirname, '../src', path)).href)
    const script = `
      const { board } = await import(${from('server/index.ts')})
      const { local } = await import(${from('backend-local/index.ts')})
      const team = board({ backend: local({ memory: true }) })
      const fix = await team.tasks.create('work', 'fix CVE-123')
      const review = await team.tasks.create('work', { text: 'review the fix', needs: [fix.task.id] })
      const claim = await team.tasks.claim(fix.task.id)
      const done = await claim.complete('fixed')
      const { message } = await team.thread(review.task.id)
      console.log(done.task.state, message.task.state)
    `
    const ran = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script]).catch((error: { code?: number; stdout?: string }) => error)
    expect({ code: 'code' in ran ? ran.code : 0, stdout: ran.stdout?.trim() }).toEqual({ code: 0, stdout: 'completed ready' })
  }, 30_000)

  it('keeps waiting for one that failed or was canceled, until the failed one is reopened and completes', async () => {
    const { ada } = setup()
    const build = await task(ada, 'build the image')
    const deploy = await task(ada, 'deploy it', { needs: [build.id] })
    await ada('POST', `/tasks/${build.id}/fail`, { ...(await claim(ada, build.id)), reason: 'registry is down' })
    expect(await stateOf(ada, deploy.id)).toBe('waiting')
    expect(code(await ada('POST', `/tasks/${deploy.id}/claim`, {}))).toEqual([409, 'task_waiting'])
    await ada('POST', `/tasks/${build.id}/reopen`)
    expect(await stateOf(ada, deploy.id)).toBe('waiting')
    await ada('POST', `/tasks/${build.id}/complete`, await claim(ada, build.id))
    expect(await stateOf(ada, deploy.id)).toBe('ready')

    const lint = await task(ada, 'lint')
    const merge = await task(ada, 'merge', { needs: [lint.id] })
    expect((await ada('POST', `/tasks/${lint.id}/cancel`, { reason: 'not needed after all' })).body.task.task).toMatchObject({ state: 'canceled', reason: 'not needed after all' })
    expect(await stateOf(ada, merge.id)).toBe('waiting')
    expect((await ada('GET', `/tasks?needs=${lint.id}`)).body.tasks.map((t: { message: MessageView }) => t.message.id)).toEqual([merge.id])
  })

  it('names only tasks the caller can read, and never itself', async () => {
    const { board, ada } = setup()
    await grantCi(board, { work: ['read', 'post', 'label'] })
    const runner = ci(board)
    const plain = (await ada('POST', '/messages', { channel: 'work', text: 'not a task' })).body.message
    const secret = await task(ada, 'rotate the keys', { channel: 'elsewhere' })
    const mine = await task(runner, 'bump the lockfile')
    for (const needs of [[plain.id], ['999'], ['nope'], [secret.id], [mine.id, plain.id]])
      expect(code(await runner('POST', '/tasks', { channel: 'work', text: 'after that', needs })), JSON.stringify(needs)).toEqual([400, 'invalid_needs'])
    // What it can't read answers as what isn't there.
    const missing = await runner('POST', '/tasks', { channel: 'work', text: 'after that', needs: ['999'] })
    const hidden = await runner('POST', '/tasks', { channel: 'work', text: 'after that', needs: [secret.id] })
    expect(hidden.body.error.message).toBe(missing.body.error.message.replace('999', secret.id))
    expect(code(await runner('POST', '/tasks', { re: plain.id, needs: [plain.id] }))).toEqual([400, 'invalid_needs'])
    expect((await runner('GET', '/messages?channel=work')).body.messages.map((m: MessageView) => m.text)).toEqual(['not a task', 'bump the lockfile'])
    expect((await runner('POST', '/tasks', { re: plain.id, needs: [mine.id] })).body.task.task).toMatchObject({ state: 'waiting', needs: [mine.id] })
  })
})

describe('a hold for a person', () => {
  it('keeps a task from being claimed until its owner lifts it, back to where it stood', async () => {
    const { ada, bo } = setup()
    const { id } = await task(ada, 'deploy to prod')
    const held = await ada('POST', `/tasks/${id}/block`, { reason: 'approve the prod deploy?', kind: 'awaiting_approval' })
    expect(held.body.task).toMatchObject({ labels: { 'board.task': 'blocked' }, task: { state: 'blocked', blocked: { kind: 'awaiting_approval', reason: 'approve the prod deploy?' } } })
    expect(code(await bo('POST', `/tasks/${id}/claim`, {}))).toEqual([409, 'task_blocked'])
    expect(code(await ada('POST', `/tasks/${id}/block`, { reason: 'again' }))).toEqual([409, 'task_blocked'])
    expect((await ada('POST', `/tasks/${id}/unblock`)).body.task).toMatchObject({ labels: { 'board.task': 'ready' }, task: { state: 'ready', blocked: null } })
    // Lifting a hold that isn't there leaves the task as it is.
    const before = (await ada('GET', '/events')).body.cursor
    expect((await ada('POST', `/tasks/${id}/unblock`)).body.task.task.state).toBe('ready')
    expect((await ada('GET', '/events')).body.cursor).toBe(before)
    expect((await ada('POST', `/tasks/${id}/block`, { reason: 'no kind' })).body.task.task.blocked).toEqual({ kind: null, reason: 'no kind' })
    expect(code(await ada('POST', `/tasks/${id}/block`, { reason: '' }))).toEqual([400, 'invalid_request'])
  })

  it('returns a task to waiting while what it needs has not completed, and to ready once it has', async () => {
    const { ada } = setup()
    const first = await task(ada, 'first')
    const second = await task(ada, 'second', { needs: [first.id] })
    await ada('POST', `/tasks/${second.id}/block`, { reason: 'is this still wanted?' })
    expect((await ada('POST', `/tasks/${second.id}/unblock`)).body.task).toMatchObject({ labels: { 'board.task': 'waiting' }, task: { state: 'waiting' } })
    // Held while its prerequisite completes: nothing readies it then, and lifting the hold does.
    await ada('POST', `/tasks/${second.id}/block`, { reason: 'hold on' })
    await ada('POST', `/tasks/${first.id}/complete`, await claim(ada, first.id))
    expect(await stateOf(ada, second.id)).toBe('blocked')
    expect((await ada('POST', `/tasks/${second.id}/unblock`)).body.task).toMatchObject({ labels: { 'board.task': 'ready' }, task: { state: 'ready' } })
  })

  it("is its claimant's to place on a claimed task, which ends the claim", async () => {
    const { ada, bo } = setup()
    const { id } = await task(ada, 'migrate the table')
    const held = await claim(bo, id, { lease: 60 })
    // Its owner waits for the claim, or cancels the task.
    expect(code(await ada('POST', `/tasks/${id}/block`, { reason: 'wait' }))).toEqual([409, 'task_claimed'])
    expect(code(await bo('POST', `/tasks/${id}/block`, { reason: 'half a claim', epoch: held.epoch }))).toEqual([400, 'invalid_request'])
    const blocked = await bo('POST', `/tasks/${id}/block`, { reason: 'drop the old column too?', kind: 'needs_input', epoch: held.epoch, token: held.token })
    expect(blocked.body.task.task).toMatchObject({ state: 'blocked', claim: null, blocked: { kind: 'needs_input', reason: 'drop the old column too?' } })
    expect(code(await bo('POST', `/tasks/${id}/complete`, held))).toEqual([409, 'claim_lost'])
    // A claim whose lease ran out holds nothing: its owner holds the task then.
    await ada('POST', `/tasks/${id}/unblock`)
    await claim(bo, id, { lease: 30 })
    vi.setSystemTime(T0 + 31 * SECOND)
    expect((await ada('POST', `/tasks/${id}/block`, { reason: 'bo went quiet' })).body.task.task).toMatchObject({ state: 'blocked', claim: null })
  })
})

describe("a task's owner", () => {
  it('changes it, as does manage in its channel, and no one else', async () => {
    const { board, ada } = setup()
    const deployment = web(board)
    const own = await task(deployment, 'rebuild the index')
    expect(own.task?.owner).toBe(WEB)
    // Ada manages every channel: she changes a task she doesn't own.
    const theirs = await task(ada, 'rotate the keys')
    for (const [verb, body] of [
      ['block', { reason: 'not yet' }],
      ['unblock', undefined],
      ['reopen', undefined],
      ['assign', { for: `${ADA}+fixer` }],
      ['cancel', { reason: 'mine now' }],
    ] as const)
      expect(code(await deployment('POST', `/tasks/${theirs.id}/${verb}`, body)), verb).toEqual([403, 'task_not_owned'])
    expect((await read(ada, theirs.id)).task).toMatchObject({ state: 'ready', for: null })
    // It may claim and settle it all the same: that takes `label`, not the task.
    expect((await deployment('POST', `/tasks/${theirs.id}/complete`, await claim(deployment, theirs.id))).status).toBe(200)

    expect((await deployment('POST', `/tasks/${own.id}/block`, { reason: 'waiting on infra' })).status).toBe(200)
    expect((await ada('POST', `/tasks/${own.id}/unblock`)).body.task.task.state).toBe('ready')
    expect((await ada('POST', `/tasks/${own.id}/assign`, { for: `${WEB}+indexer` })).body.task.task.for).toBe(`${WEB}+indexer`)
    expect((await ada('POST', `/tasks/${own.id}/cancel`, { reason: 'superseded' })).body.task.task).toMatchObject({ state: 'canceled', reason: 'superseded' })
    expect(code(await deployment('POST', `/tasks/${own.id}/cancel`, { reason: 'again' }))).toEqual([409, 'task_finished'])
    expect(code(await deployment('POST', `/tasks/${own.id}/block`, { reason: 'too late' }))).toEqual([409, 'task_finished'])
    expect(code(await deployment('POST', `/tasks/${own.id}/unblock`))).toEqual([409, 'task_finished'])
    expect(code(await deployment('POST', `/tasks/${own.id}/assign`, { for: null }))).toEqual([409, 'task_finished'])
  })

  it('is its principal only while it may still write there: a token narrowed to reading changes nothing', async () => {
    const { ada, board } = setup()
    const { id } = await task(ada, 'rotate the keys')
    const sandboxed = person(board, 'ada', { 'x-board-can': 'work=read' })
    expect(code(await sandboxed('POST', `/tasks/${id}/cancel`, { reason: 'from a sandbox' }))).toEqual([403, 'task_not_owned'])
    expect(await stateOf(ada, id)).toBe('ready')
    const posting = person(board, 'ada', { 'x-board-can': 'work=read,post' })
    expect((await posting('POST', `/tasks/${id}/cancel`, { reason: 'from one that posts' })).status).toBe(200)
  })

  it('assigns it to one of its own profiles, the only actor that claims it then, lease or no lease', async () => {
    const { ada, bo, board } = setup({ scheduler: undefined })
    const fixer = person(board, 'ada', { 'x-board-profile': 'fixer' })
    const reviewer = person(board, 'ada', { 'x-board-profile': 'reviewer' })
    const made = await task(ada, 'fix CVE-123', { for: `${ADA}+fixer` })
    expect(made.task?.for).toBe(`${ADA}+fixer`)
    for (const call of [ada, reviewer, bo]) expect(code(await call('POST', `/tasks/${made.id}/claim`, {}))).toEqual([409, 'task_assigned'])
    const held = await claim(fixer, made.id, { lease: 30 })
    expect((await read(ada, made.id)).task?.claim).toMatchObject({ actor: `${ADA}+fixer` })
    // A quiet agent keeps its work: the lease runs out, and it's still only the fixer's.
    vi.setSystemTime(T0 + 31 * SECOND)
    expect(code(await reviewer('POST', `/tasks/${made.id}/claim`, {}))).toEqual([409, 'task_assigned'])
    expect((await reviewer('POST', '/tasks/claim', { channel: 'work' })).body).toEqual({ task: null })
    expect((await fixer('POST', `/tasks/${made.id}/claim`, {})).body.claim.epoch).toBe(held.epoch + 1)

    // Assigned later, only that actor; back to the pool, anyone who may.
    const other = await task(ada, 'review the fix')
    expect((await ada('POST', `/tasks/${other.id}/assign`, { for: `${ADA}+reviewer` })).body.task.task.for).toBe(`${ADA}+reviewer`)
    expect(code(await fixer('POST', `/tasks/${other.id}/claim`, {}))).toEqual([409, 'task_assigned'])
    expect((await ada('POST', `/tasks/${other.id}/assign`, { for: null })).body.task.task.for).toBeNull()
    expect((await fixer('POST', `/tasks/${other.id}/claim`, {})).status).toBe(200)

    // Only the owner's own actors: another principal's, or one that isn't a profile of it, is refused.
    for (const actor of [`${BO}+fixer`, ADA, `${ADA}+`, `${ADA}+Not A Profile`, 'fixer'])
      expect(code(await ada('POST', '/tasks', { channel: 'work', text: 'for someone else', for: actor })), actor).toEqual([400, 'invalid_request'])
    expect(code(await ada('POST', `/tasks/${other.id}/assign`, { for: `${BO}+fixer` }))).toEqual([400, 'invalid_request'])
    expect(code(await ada('POST', '/tasks', { channel: 'work', text: 'claimed for another', for: `${ADA}+fixer`, claim: true }))).toEqual([409, 'task_assigned'])
    expect((await fixer('POST', '/tasks', { channel: 'work', text: 'mine from the start', for: `${ADA}+fixer`, claim: true })).body.task.task).toMatchObject({ state: 'claimed', claim: { actor: `${ADA}+fixer` } })
  })
})

describe('claiming the next ready task', () => {
  it('takes the oldest in a channel or its subtree that has every label asked for', async () => {
    const { ada } = setup()
    const review = await task(ada, 'review the fix', { labels: { step: 'review' } })
    const fix = await task(ada, 'fix CVE-123', { labels: { step: 'fix', area: 'web' } })
    const later = await task(ada, 'fix CVE-456', { channel: 'work/api', labels: { step: 'fix' } })
    await task(ada, 'elsewhere', { channel: 'ops', labels: { step: 'fix' } })

    expect((await ada('POST', '/tasks/claim', { channel: 'work', label: { step: 'fix', area: 'api' } })).body).toEqual({ task: null })
    const first = await ada('POST', '/tasks/claim', { channel: 'work/', label: { step: 'fix' }, lease: 60 })
    expect(first.body).toMatchObject({ task: { id: fix.id, task: { state: 'claimed' } }, claim: { epoch: 1, until: at(MINUTE) } })
    // The channel alone leaves out what's under it; the subtree has both.
    expect((await ada('POST', '/tasks/claim', { channel: 'work', label: { step: 'fix' } })).body).toEqual({ task: null })
    expect((await ada('POST', '/tasks/claim', { channel: 'work/', label: { step: 'fix' } })).body.task.id).toBe(later.id)
    expect((await ada('POST', '/tasks/claim', { channel: 'work/' })).body.task.id).toBe(review.id)
    expect((await ada('POST', '/tasks/claim', { channel: 'work/' })).body).toEqual({ task: null })
    expect(code(await ada('POST', '/tasks/claim', { channel: 'Not A Channel' }))).toEqual([400, 'invalid_request'])
  })

  it("takes the caller's own tasks, and another owner's only when it names them", async () => {
    const { ada, bo, board } = setup()
    const deployment = web(board)
    const hers = await task(ada, "ada's")
    const theirs = await task(deployment, "the deployment's")
    const his = await task(bo, "bo's")
    // A task's text is instructions: Bo's agents take them from Bo, unless he says who else.
    expect((await bo('POST', '/tasks/claim', { channel: 'work' })).body.task.id).toBe(his.id)
    expect((await bo('POST', '/tasks/claim', { channel: 'work' })).body).toEqual({ task: null })
    expect((await bo('POST', '/tasks/claim', { channel: 'work', from: ['nobody'] })).body).toEqual({ task: null })
    expect((await bo('POST', '/tasks/claim', { channel: 'work', from: ['ada', WEB] })).body.task.id).toBe(hers.id)
    expect((await bo('POST', '/tasks/claim', { channel: 'work', from: ['ada', WEB] })).body.task.id).toBe(theirs.id)
  })

  it('takes one assigned to the caller before an older one from the pool', async () => {
    const { ada, board } = setup()
    const fixer = person(board, 'ada', { 'x-board-profile': 'fixer' })
    const pool = await task(ada, 'anyone can do this')
    const reviewers = await task(ada, 'for the reviewer', { for: `${ADA}+reviewer` })
    const mine = await task(ada, 'for the fixer', { for: `${ADA}+fixer` })
    expect((await fixer('POST', '/tasks/claim', { channel: 'work' })).body.task.id).toBe(mine.id)
    expect((await fixer('POST', '/tasks/claim', { channel: 'work' })).body.task.id).toBe(pool.id)
    expect((await fixer('POST', '/tasks/claim', { channel: 'work' })).body).toEqual({ task: null })
    expect(await stateOf(ada, reviewers.id)).toBe('ready')
  })

  it('holds a request that waits until a task is ready, or answers null when none comes', async () => {
    const { ada, bo } = setup()
    const fix = await task(ada, 'fix CVE-123')
    const review = await task(ada, 'review the fix', { labels: { step: 'review' }, needs: [fix.id] })
    const waiting = ada('POST', '/tasks/claim', { channel: 'work', label: { step: 'review' }, wait: 10 })
    let answered = false
    void waiting.then(() => (answered = true))
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(answered).toBe(false)
    await bo('POST', `/tasks/${fix.id}/complete`, await claim(bo, fix.id))
    expect((await waiting).body).toMatchObject({ task: { id: review.id, task: { state: 'claimed' } }, claim: { epoch: 1 } })
    // With nothing coming, it answers null once its wait is over. The real clock is weeks past the
    // faked one, so the claim above has lapsed by it: a label no task has leaves nothing to take.
    vi.useRealTimers()
    const started = Date.now()
    expect((await ada('POST', '/tasks/claim', { channel: 'work', label: { step: 'nothing-has-this' }, wait: 0.3 })).body).toEqual({ task: null })
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)
    expect(code(await ada('POST', '/tasks/claim', { channel: 'work', wait: 301 }))).toEqual([400, 'invalid_request'])
  })
})

describe('listing tasks', () => {
  it('lists open tasks oldest first, as thread summaries, and others by their state', async () => {
    const { ada, bo } = setup()
    const waiting = await task(ada, 'second', { needs: [(await task(ada, 'first')).id] })
    const first = (await ada('GET', '/tasks')).body.tasks[0].message as MessageView
    const held = await task(ada, 'held')
    await ada('POST', `/tasks/${held.id}/block`, { reason: 'hold on' })
    const done = await task(bo, 'done', { channel: 'ops' })
    await bo('POST', `/tasks/${done.id}/complete`, await claim(bo, done.id))
    const dropped = await task(ada, 'dropped')
    await ada('POST', `/tasks/${dropped.id}/cancel`, { reason: 'no' })
    const working = await task(ada, 'in progress')
    await claim(bo, working.id)
    await bo('POST', '/messages', { re: working.id, text: 'halfway' })
    const last = (await bo('POST', '/messages', { re: working.id, text: 'nearly' })).body.message
    await ada('POST', '/messages', { channel: 'work', text: 'not a task at all' })

    const ids = async (query = '') => ((await ada('GET', `/tasks${query}`)).body.tasks as { message: MessageView }[]).map((t) => t.message.id)
    expect(await ids()).toEqual([first.id, waiting.id, held.id, working.id])
    expect(await ids('?state=open')).toEqual([first.id, waiting.id, held.id, working.id])
    expect(await ids('?state=all')).toEqual([first.id, waiting.id, held.id, done.id, dropped.id, working.id])
    expect(await ids('?state=ready')).toEqual([first.id])
    expect(await ids('?state=waiting')).toEqual([waiting.id])
    expect(await ids('?state=claimed')).toEqual([working.id])
    expect(await ids('?state=blocked')).toEqual([held.id])
    expect(await ids('?state=completed')).toEqual([done.id])
    expect(await ids('?state=canceled')).toEqual([dropped.id])
    expect(await ids('?state=failed')).toEqual([])
    expect(code(await ada('GET', '/tasks?state=done'))).toEqual([400, 'invalid_request'])
    expect(await ids('?state=all&channel=ops')).toEqual([done.id])
    expect(await ids('?state=all&owner=bo')).toEqual([done.id])
    expect(await ids(`?state=all&owner=${BO}`)).toEqual([done.id])
    expect(await ids('?state=all&by=bo')).toEqual([done.id])
    expect(await ids(`?needs=${first.id}`)).toEqual([waiting.id])

    // A summary: the task's root, how many replies it has, and the latest.
    const summary = (await ada('GET', '/tasks?state=claimed')).body.tasks[0]
    expect(summary).toMatchObject({ message: { id: working.id, task: { state: 'claimed' } }, replies: 2, last: { id: last.id, text: 'nearly' } })
    expect((await ada('GET', '/tasks?state=ready')).body.tasks[0]).toMatchObject({ replies: 0, last: null })
  })

  it('pages by the cursor it reports, and finds tasks by their labels and who they are for', async () => {
    const { ada } = setup()
    const made: string[] = []
    for (let n = 1; n <= 5; n++) made.push((await task(ada, `task ${n}`, { labels: { step: n % 2 ? 'fix' : 'review' }, ...(n === 4 ? { for: `${ADA}+reviewer` } : {}) })).id)
    const page = async (query: string) => {
      const { tasks, cursor } = (await ada('GET', `/tasks?${query}`)).body
      return { ids: (tasks as { message: MessageView }[]).map((t) => t.message.id), cursor: cursor as string }
    }
    const first = await page('limit=2')
    expect(first.ids).toEqual(made.slice(0, 2))
    const second = await page(`limit=2&after=${first.cursor}`)
    expect(second.ids).toEqual(made.slice(2, 4))
    const third = await page(`limit=2&after=${second.cursor}`)
    expect(third.ids).toEqual(made.slice(4))
    // Read to the end, the cursor is where the board is: a task made since comes after it.
    expect((await page(`limit=2&after=${third.cursor}`)).ids).toEqual([])
    const later = await task(ada, 'task 6')
    expect((await page(`limit=2&after=${third.cursor}`)).ids).toEqual([later.id])

    expect((await page('label=step=review')).ids).toEqual([made[1], made[3]])
    expect((await page('label=step=fix&limit=2')).ids).toEqual([made[0], made[2]])
    expect((await page(`for=${ADA}%2Breviewer`)).ids).toEqual([made[3]])
    expect((await page('for=nobody')).ids).toEqual([])
    expect(code(await ada('GET', '/tasks?after=nope'))).toEqual([400, 'invalid_cursor'])
  })

  it('shows a reader only the tasks in channels it reads', async () => {
    const { board, ada } = setup()
    await grantCi(board, { work: ['read'] })
    const shown = await task(ada, 'in the open')
    await task(ada, 'rotate the keys', { channel: 'secret' })
    const { tasks } = (await ci(board)('GET', '/tasks?state=all')).body
    expect(tasks.map((t: { message: MessageView }) => t.message.id)).toEqual([shown.id])
    expect((await ci(board)('GET', '/tasks?channel=secret')).body.tasks).toEqual([])
  })
})

describe('labels under board.', () => {
  const RESERVED = [400, 'reserved_label']

  it("are the board's own: no request sets or unsets one, on any route that writes labels", async () => {
    const { ada, board } = setup()
    const { id } = await task(ada, 'fix CVE-123')
    expect(code(await ada('POST', `/messages/${id}/labels`, { set: { 'board.task': 'completed' } }))).toEqual(RESERVED)
    expect(code(await ada('POST', `/messages/${id}/labels`, { unset: ['board.task'] }))).toEqual(RESERVED)
    expect(code(await ada('POST', `/messages/${id}/labels`, { set: { step: 'fix', 'board.anything': 'x' } }))).toEqual(RESERVED)
    expect(code(await ada('POST', '/messages', { channel: 'work', text: 'looks ready', labels: { 'board.task': 'ready' } }))).toEqual(RESERVED)
    expect(code(await ada('POST', '/messages', { re: id, text: 'a reply', labels: { 'board.note': 'x' } }))).toEqual(RESERVED)
    expect(code(await ada('POST', '/tasks', { channel: 'work', text: 'born completed', labels: { 'board.task': 'completed' } }))).toEqual(RESERVED)
    expect(code(await ada('POST', '/schedules', { channel: 'work', text: 'later', in: '1h', labels: { 'board.task': 'ready' } }))).toEqual(RESERVED)
    // A sync elsewhere, speaking for a platform user.
    const sync = web(board)
    expect((await sync('POST', '/watchers', { watch: {}, sync: [{ key: 'slack', platform: 'slack' }] })).status).toBe(200)
    const author = { id: 'slack:user:U_EVE', handle: 'eve', name: 'Eve', avatar: null, isBot: false }
    expect(code(await sync('POST', '/sync/imports', { op: 'post', author, from: 'slack', channel: 'work', text: 'from Slack', labels: { 'board.task': 'ready' } }))).toEqual(RESERVED)
    expect(code(await sync('POST', '/sync/imports', { op: 'labels', author, from: 'slack', message: id, set: { 'board.task': 'completed' } }))).toEqual(RESERVED)
    expect(code(await sync('POST', '/sync/imports', { op: 'labels', author, from: 'slack', message: id, unset: ['board.task'] }))).toEqual(RESERVED)

    // Nothing landed, and the task is as it was.
    expect((await ada('GET', '/messages?channel=work')).body.messages.map((m: MessageView) => m.text)).toEqual(['fix CVE-123'])
    expect(await read(ada, id)).toMatchObject({ labels: { 'board.task': 'ready' }, task: { state: 'ready' } })
    expect((await ada('GET', '/schedules')).body.schedules).toEqual([])
    // A key that only looks like one is anyone's.
    expect((await ada('POST', `/messages/${id}/labels`, { set: { board: 'x', 'boarding.pass': 'y', 'my.board.task': 'z' } })).status).toBe(200)
  })

  it("are refused the board's own code too: its handle, a watcher, and what the middleware adds", async () => {
    const stamp: Middleware = async ({ write, next }) => next(write.text.includes('stamp me') ? { labels: { 'board.task': 'ready' } } : {})
    const seen: string[] = []
    const watcher: Watcher = {
      tail: 'work',
      run: async ({ event, board }) => {
        if (event.type !== 'message.posted' || event.message?.text !== 'label this') return
        await board.label(event.message.id, { set: { 'board.task': 'ready' } }).catch((error: { code: string }) => seen.push(error.code))
      },
    }
    const { ada, board } = setup({ middleware: [stamp], watch: { labeler: watcher } })
    const root = await board.post('work', 'from the handle')
    await expect(board.label(root.id, { set: { 'board.task': 'ready' } })).rejects.toMatchObject({ status: 400, code: 'reserved_label' })
    await expect(board.post('work', { text: 'labeled from the handle', labels: { 'board.task': 'ready' } })).rejects.toMatchObject({ status: 400, code: 'reserved_label' })
    expect(code(await ada('POST', '/messages', { channel: 'work', text: 'stamp me' }))).toEqual(RESERVED)
    expect(code(await ada('POST', '/tasks', { channel: 'work', text: 'stamp me too' }))).toEqual(RESERVED)
    await ada('POST', '/messages', { channel: 'work', text: 'label this' })
    await vi.waitFor(() => expect(seen).toEqual(['reserved_label']))
    const { messages } = (await ada('GET', '/messages?channel=work')).body
    expect(messages.map((m: MessageView) => [m.text, m.labels])).toEqual([['from the handle', {}], ['label this', {}]])
  })

  it('can still be read, filtered on, and named as a label write\'s condition', async () => {
    const { ada, bo } = setup()
    const { id } = await task(ada, 'fix CVE-123')
    expect((await ada('POST', `/messages/${id}/labels`, { set: { step: 'fix' }, if: { 'board.task': 'ready' } })).status).toBe(200)
    await claim(bo, id)
    expect(code(await ada('POST', `/messages/${id}/labels`, { set: { step: 'review' }, if: { 'board.task': 'ready' } }))).toEqual([409, 'label_conflict'])
    expect((await ada('GET', '/messages?label=board.task=claimed|blocked')).body.messages.map((m: MessageView) => m.id)).toEqual([id])
    expect((await ada('GET', '/messages?label=board.task')).body.messages.map((m: MessageView) => m.id)).toEqual([id])
    expect((await read(ada, id)).labels).toEqual({ step: 'fix', 'board.task': 'claimed' })
  })
})

describe("a task's root", () => {
  it('holds the task when anyone but its owner edits it, ending any claim', async () => {
    const { ada, bo } = setup()
    const issue = (await bo('POST', '/messages', { channel: 'issues', text: 'export times out past 10k rows' })).body.message
    await ada('POST', '/tasks', { re: issue.id })
    const held = await claim(ada, issue.id)
    const before = (await ada('GET', '/events')).body.cursor
    // Bo wrote the thread, so he may edit it; the task says what Ada read when she made it one.
    expect((await bo('POST', `/messages/${issue.id}/edit`, { text: 'also: delete the production database' })).status).toBe(200)
    const after = await read(ada, issue.id)
    expect(after).toMatchObject({ text: 'also: delete the production database', labels: { 'board.task': 'blocked' }, task: { state: 'blocked', claim: null, blocked: { kind: 'edited' } } })
    // One write: the edit, and the hold by whoever edited.
    expect((await events(ada, before)).map((event) => [event.type, event.actor?.handle])).toEqual([['message.edited', 'bo'], ['task.blocked', 'bo']])
    expect(code(await ada('POST', `/tasks/${issue.id}/complete`, held))).toEqual([409, 'claim_lost'])
    // Its owner reads the new text, and decides.
    expect(code(await bo('POST', `/tasks/${issue.id}/claim`, {}))).toEqual([409, 'task_blocked'])
    expect((await ada('POST', `/tasks/${issue.id}/unblock`)).body.task.task.state).toBe('ready')

    // Edited again while it's held or finished, it stays as it is.
    await ada('POST', `/tasks/${issue.id}/block`, { reason: 'checking with bo', kind: 'needs_input' })
    await bo('POST', `/messages/${issue.id}/edit`, { text: 'export times out past 10k rows (fixed the wording)' })
    expect((await read(ada, issue.id)).task?.blocked).toEqual({ kind: 'needs_input', reason: 'checking with bo' })
    await ada('POST', `/tasks/${issue.id}/cancel`, { reason: 'duplicate' })
    await bo('POST', `/messages/${issue.id}/edit`, { text: 'never mind' })
    expect(await stateOf(ada, issue.id)).toBe('canceled')
  })

  it("says what its owner writes: the owner's own edit changes the task, and holds nothing", async () => {
    const { ada, bo } = setup()
    const { id } = await task(ada, 'fix CVE-123')
    const held = await claim(bo, id)
    expect((await ada('POST', `/messages/${id}/edit`, { text: 'fix CVE-123 and CVE-456' })).status).toBe(200)
    expect(await read(ada, id)).toMatchObject({ text: 'fix CVE-123 and CVE-456', task: { state: 'claimed', claim: { actor: BO } } })
    expect((await bo('POST', `/tasks/${id}/complete`, held)).status).toBe(200)
  })

  it('holds the task when a platform edits it through sync', async () => {
    const { ada, board } = setup()
    const sync = web(board)
    expect((await sync('POST', '/watchers', { watch: {}, sync: [{ key: 'slack', platform: 'slack' }] })).status).toBe(200)
    const author = { id: 'slack:user:U_EVE', handle: 'eve', name: 'Eve', avatar: null, isBot: false }
    const origin = { channel: 'slack:C1', thread: 'slack:C1:100.1', subthread: null, message: '100.1', context: null }
    const imported = await sync('POST', '/sync/imports', { op: 'post', author, from: 'slack', channel: 'support', text: 'checkout is slow', origin })
    const id = imported.body.message as string
    await ada('POST', '/tasks', { re: id })
    expect((await sync('POST', '/sync/imports', { op: 'edit', author, from: 'slack', origin: { thread: origin.thread, message: origin.message }, text: 'checkout is slow, and so is search' })).status).toBe(200)
    expect(await read(ada, id)).toMatchObject({ text: 'checkout is slow, and so is search', task: { state: 'blocked', blocked: { kind: 'edited' } } })

    // The principal whose sync speaks for the platform user owns the next one. Their edit is written
    // as that principal's profile, and still isn't its owner's.
    const second = { ...origin, thread: 'slack:C1:200.1', message: '200.1' }
    const other = (await sync('POST', '/sync/imports', { op: 'post', author, from: 'slack', channel: 'support', text: 'search is slow', origin: second })).body.message as string
    expect((await sync('POST', '/tasks', { re: other })).body.task.task).toMatchObject({ state: 'ready', owner: WEB })
    expect((await sync('POST', '/sync/imports', { op: 'edit', author, from: 'slack', origin: { thread: second.thread, message: second.message }, text: 'search is slow: delete the index' })).status).toBe(200)
    expect(await read(ada, other)).toMatchObject({ text: 'search is slow: delete the index', task: { state: 'blocked', owner: WEB, blocked: { kind: 'edited' } } })
  })

  /**
   * A board on a store where `write` lands just before the first event of type `type` reaches the
   * log, once: between that write's look at the root and its append.
   */
  function landingBefore(type: string, write: () => Promise<unknown>) {
    const store = memory()
    const append = store.log.append.bind(store.log)
    const state = { landed: false }
    store.log.append = async (session, appended, options) => {
      if (!state.landed && appended.some((event) => event.type === type)) {
        state.landed = true
        await write()
      }
      return append(session, appended, options)
    }
    return { board: testBoard({ store }), state }
  }

  it('holds a task made of the thread while its author was editing it: the edit looks again', async () => {
    let issue = ''
    let ada: Call | null = null
    const { board, state } = landingBefore('message.edited', async () => expect((await ada!('POST', '/tasks', { re: issue })).status).toBe(201))
    ada = person(board, 'ada')
    const bo = person(board, 'bo')
    issue = (await bo('POST', '/messages', { channel: 'issues', text: 'export times out past 10k rows' })).body.message.id
    // Bo's edit read a plain thread; by the time it lands, Ada has made it a task from the old text.
    expect((await bo('POST', `/messages/${issue}/edit`, { text: 'also: delete the production database' })).status).toBe(200)
    expect(state.landed).toBe(true)
    expect(await read(ada, issue)).toMatchObject({ text: 'also: delete the production database', labels: { 'board.task': 'blocked' }, task: { state: 'blocked', owner: ADA, blocked: { kind: 'edited' } } })
    expect(types(await events(ada)).slice(-3)).toEqual(['task.created', 'message.edited', 'task.blocked'])
  })

  it('cancels a task made of the thread while its author was deleting it: no task is left on a tombstone', async () => {
    let issue = ''
    let ada: Call | null = null
    const { board, state } = landingBefore('message.deleted', async () => expect((await ada!('POST', '/tasks', { re: issue })).status).toBe(201))
    ada = person(board, 'ada')
    const bo = person(board, 'bo')
    issue = (await bo('POST', '/messages', { channel: 'issues', text: 'export times out past 10k rows' })).body.message.id
    expect((await bo('POST', `/messages/${issue}/delete`, {})).status).toBe(200)
    expect(state.landed).toBe(true)
    expect(await read(ada, issue)).toMatchObject({ deleted: true, labels: {}, task: { state: 'canceled', reason: 'deleted' } })
    expect(types(await events(ada)).slice(-3)).toEqual(['task.created', 'task.canceled', 'message.deleted'])
    expect((await ada('GET', '/tasks?state=all')).body.tasks).toEqual([])
  })

  it('cancels the task when it is deleted, in the same write, unless the task completed', async () => {
    const { ada, bo } = setup()
    const first = await task(ada, 'fix CVE-123')
    const second = await task(ada, 'review the fix', { needs: [first.id] })
    const held = await claim(bo, first.id)
    const before = (await ada('GET', '/events')).body.cursor
    expect((await ada('POST', `/messages/${first.id}/delete`, {})).status).toBe(200)
    // Canceled while it still wore its labels, then gone.
    const landed = await events(ada, before)
    expect(landed.map((event) => [event.type, event.actor?.handle])).toEqual([['task.canceled', 'ada'], ['message.deleted', 'ada']])
    expect(landed[0]).toMatchObject({ payload: { reason: 'deleted' }, message: { deleted: false, labels: { 'board.task': 'canceled' } } })
    const gone = await read(ada, first.id)
    expect(gone).toMatchObject({ deleted: true, text: '', labels: {}, task: { state: 'canceled', reason: 'deleted', claim: null } })
    expect(code(await bo('POST', `/tasks/${first.id}/complete`, held))).toEqual([409, 'claim_lost'])
    expect((await ada('GET', '/tasks?state=all')).body.tasks.map((t: { message: MessageView }) => t.message.id)).toEqual([second.id])
    expect(await stateOf(ada, second.id)).toBe('waiting')

    // One that completed stays completed: its deletion is only a deletion.
    const done = await task(ada, 'ship it')
    await ada('POST', `/tasks/${done.id}/complete`, await claim(ada, done.id))
    const then = (await ada('GET', '/events')).body.cursor
    await ada('POST', `/messages/${done.id}/delete`, {})
    expect(types(await events(ada, then))).toEqual(['message.deleted'])
    expect((await read(ada, done.id)).task).toMatchObject({ state: 'completed' })
  })
})

describe('task events', () => {
  it('reach the feed as board events, one for each change, and none shows a claim\'s token', async () => {
    const { ada, bo, board } = setup()
    const fixer = person(board, 'ada', { 'x-board-profile': 'fixer', 'x-board-session': 'run-7' })
    const first = await task(ada, 'fix CVE-123')
    const second = await task(ada, 'review the fix', { needs: [first.id] })
    await ada('POST', `/tasks/${first.id}/assign`, { for: `${ADA}+fixer` })
    const held = await claim(fixer, first.id)
    await fixer('POST', `/tasks/${first.id}/renew`, held)
    await fixer('POST', `/tasks/${first.id}/release`, held)
    const again = await claim(fixer, first.id)
    await fixer('POST', `/tasks/${first.id}/fail`, { ...again, reason: 'flaky' })
    await ada('POST', `/tasks/${first.id}/reopen`)
    await ada('POST', `/tasks/${first.id}/block`, { reason: 'hold', kind: 'needs_input' })
    await ada('POST', `/tasks/${first.id}/unblock`)
    const last = await claim(fixer, first.id)
    await fixer('POST', `/tasks/${first.id}/complete`, { ...last, result: 'fixed' })
    await bo('POST', `/tasks/${second.id}/cancel`, { reason: 'not needed' })

    const feed = await events(ada, 0)
    const tasks = feed.filter((event) => event.type.startsWith('task.'))
    expect(tasks.map((event) => [event.type, event.message?.id, event.message?.task?.state])).toEqual([
      ['task.created', first.id, 'ready'],
      ['task.created', second.id, 'waiting'],
      ['task.assigned', first.id, 'ready'],
      ['task.claimed', first.id, 'claimed'],
      ['task.released', first.id, 'ready'],
      ['task.claimed', first.id, 'claimed'],
      ['task.failed', first.id, 'failed'],
      ['task.reopened', first.id, 'ready'],
      ['task.blocked', first.id, 'blocked'],
      ['task.unblocked', first.id, 'ready'],
      ['task.claimed', first.id, 'claimed'],
      ['task.completed', first.id, 'completed'],
      ['task.ready', second.id, 'ready'],
      ['task.canceled', second.id, 'canceled'],
    ])
    // IDs are refs, who did it is there, and a claim says its session.
    const [created, , , claimed] = tasks
    expect(created!.payload).toEqual({ id: first.id, thread: first.thread, needs: [], for: null, by: { actor: ADA, principal: ADA, profile: null, session: null } })
    expect(tasks[1]!.payload).toMatchObject({ needs: [first.id] })
    expect(claimed).toMatchObject({ payload: { id: first.id, epoch: 1, until: at(15 * MINUTE), session: 'run-7', by: { actor: `${ADA}+fixer`, session: 'run-7' } }, actor: { id: `${ADA}+fixer`, handle: 'ada/fixer' } })
    expect(claimed!.message?.task?.claim).toEqual({ actor: `${ADA}+fixer`, session: 'run-7', until: at(15 * MINUTE) })

    // A renewal is bookkeeping: only a feed that asks for everything shows it.
    expect(types(feed)).not.toContain('task.renewed')
    const everything = await events(ada, 0, '&all=1')
    expect(types(everything).filter((type) => type === 'task.renewed')).toHaveLength(1)
    // No view carries a claim's token, or its hash: not an event's payload, nor a message's task.
    for (const seen of [JSON.stringify(everything), JSON.stringify((await ada('GET', `/messages/${first.id}`)).body), JSON.stringify((await ada('GET', '/tasks?state=all')).body)]) {
      for (const secret of [held.token, again.token, last.token]) expect(seen).not.toContain(secret)
      expect(seen).not.toMatch(/"token"/)
      expect(seen).not.toMatch(/[0-9a-f]{64}/)
    }
  })

  it('show a filtered feed a task entering and leaving its filter, as label changes do', async () => {
    const { ada, bo } = setup()
    const first = await task(ada, 'fix CVE-123')
    const second = await task(ada, 'review the fix', { needs: [first.id] })
    const other = await task(ada, 'elsewhere', { channel: 'ops' })
    const { cursor } = (await ada('GET', '/events')).body
    await bo('POST', `/tasks/${first.id}/complete`, await claim(bo, first.id))
    await claim(bo, second.id)
    await claim(bo, other.id)
    await bo('POST', '/messages', { re: second.id, text: 'on it' })
    // `vb tail work --label board.task=ready`: the first leaves ready, the second enters it and leaves it.
    const ready = await events(ada, cursor, '&channel=work&label=board.task=ready')
    expect(ready.map((event) => [event.type, event.message?.id])).toEqual([['task.claimed', first.id], ['task.ready', second.id], ['task.claimed', second.id]])
    const claimed = await events(ada, cursor, '&label=board.task=claimed')
    expect(claimed.map((event) => [event.type, event.message?.id])).toEqual([
      ['task.claimed', first.id],
      ['task.completed', first.id],
      ['task.claimed', second.id],
      ['task.claimed', other.id],
      // A reply in a thread whose root wears the label matches too, as any label's does.
      ['message.posted', expect.any(String)],
    ])
  })

  it('wake a watcher whose tail they match, with the event a tail would print', async () => {
    const seen: BoardEventView[] = []
    const watcher: Watcher = { tail: 'work --label board.task=ready', run: ({ event }) => void seen.push(event) }
    const { ada, bo } = setup({ watch: { dispatcher: watcher } })
    const first = await task(ada, 'fix CVE-123')
    const second = await task(ada, 'review the fix', { needs: [first.id] })
    const held = await claim(bo, first.id)
    await bo('POST', `/tasks/${first.id}/renew`, held)
    await bo('POST', `/tasks/${first.id}/complete`, held)
    // A task enters the tail when it's made one, leaves it when it's claimed, and a renewal is no one's news.
    await vi.waitFor(() => expect(seen.map((event) => [event.type, event.message?.id])).toEqual([
      ['task.created', first.id],
      ['task.claimed', first.id],
      ['task.ready', second.id],
    ]))
    expect(JSON.stringify(seen)).not.toContain(held.token)
    expect(JSON.stringify(seen)).not.toMatch(/"token"/)
    expect(seen[2]!.message).toMatchObject({ labels: { 'board.task': 'ready' }, task: { state: 'ready', needs: [first.id] } })
  })
})

describe("the handle's tasks", () => {
  it('runs a worker as the spec writes it: claim the next ready task, work it in its thread, complete it', async () => {
    const { board, ada } = setup()
    const team = board
    const { task: fix } = await team.tasks.create('work', { text: 'fix CVE-123 in acme/web', labels: { step: 'fix' } })
    const { task: review } = await team.tasks.create('work', { text: 'review the fix for CVE-123', labels: { step: 'review' }, needs: [fix.id] })
    expect([fix.task?.state, review.task?.state]).toEqual(['ready', 'waiting'])

    const claim = await team.tasks.claim({ channel: 'work/', label: { step: 'fix' }, wait: 600 }) // null when none came
    expect(claim).not.toBeNull()
    if (claim) {
      await team.reply(claim.task.id, 'patched, running the tests')
      await claim.complete('fixed in a1b2c3, tests pass')
    }
    expect(claim).toMatchObject({ task: { id: fix.id }, epoch: 1, until: at(15 * MINUTE) })
    expect((await read(ada, fix.id)).task).toMatchObject({ state: 'completed', result: 'fixed in a1b2c3, tests pass' })
    const { tasks, cursor } = await team.tasks.list({ channel: 'work/', state: 'all', label: { step: 'review' } })
    expect(tasks.map((t) => [t.message.id, t.message.task?.state])).toEqual([[review.id, 'ready']])
    expect(typeof cursor).toBe('string')
    expect(await team.tasks.claim({ channel: 'work/', label: { step: 'fix' } })).toBeNull()
  })

  it('claims by id, holds a claim from its epoch and token alone, and changes a task as its owner', async () => {
    const { board, ada } = setup()
    const team = board
    const issue = await team.post('issues', 'export times out past 10k rows')
    const adopted = await team.tasks.create({ re: issue.id }, { claim: true, lease: 120 })
    expect(adopted.task.id).toBe(issue.id)
    expect(adopted.claim).toMatchObject({ epoch: 1, until: at(2 * MINUTE) })
    await expect(team.tasks.claim(issue.id)).rejects.toMatchObject({ status: 409, code: 'task_claimed' })
    // Another process that kept the claim's epoch and token acts on it.
    const kept = { epoch: adopted.claim!.epoch, token: adopted.claim!.token }
    const renewed = await team.tasks.held(issue.id, kept).renew(600)
    expect(renewed).toMatchObject({ epoch: 1, token: kept.token, until: at(10 * MINUTE), task: { id: issue.id } })
    expect((await team.tasks.held(issue.id, kept).block('which export?', { kind: 'needs_input' })).task).toMatchObject({ state: 'blocked', blocked: { kind: 'needs_input', reason: 'which export?' } })
    await expect(renewed.release()).rejects.toMatchObject({ status: 409, code: 'claim_lost' })

    expect((await team.tasks.unblock(issue.id)).task?.state).toBe('ready')
    expect((await team.tasks.block(issue.id, 'hold on')).task?.state).toBe('blocked')
    await team.tasks.unblock(issue.id)
    const failing = await team.tasks.claim(issue.id, { lease: 60 })
    expect(failing.until).toBe(at(MINUTE))
    expect((await failing.fail('no repro')).task).toMatchObject({ state: 'failed', reason: 'no repro' })
    expect((await team.tasks.reopen(issue.id)).task?.state).toBe('ready')
    const released = await (await team.tasks.claim(issue.id)).release()
    expect(released.task?.state).toBe('ready')
    expect((await team.tasks.cancel(issue.id, 'duplicate')).task).toMatchObject({ state: 'canceled', reason: 'duplicate' })
    // A plain string is the task's text, as a post's is, and a client id makes it once.
    const once = await team.tasks.create('work', { text: 'deploy a1b2c3', id: 'deploy-a1b2c3' })
    expect((await team.tasks.create('work', { text: 'deploy a1b2c3', id: 'deploy-a1b2c3' })).task.id).toBe(once.task.id)
    expect((await team.tasks.create('work', 'tidy up')).task).toMatchObject({ text: 'tidy up', task: { state: 'ready', owner: 'board:client' } })
    expect((await ada('GET', '/tasks?channel=work')).body.tasks).toHaveLength(2)
  })

  it('waits for a task that becomes ready while it asks', async () => {
    const { board } = setup()
    vi.useRealTimers()
    const waiting = board.tasks.claim({ channel: 'work', wait: 5, lease: 30 })
    await new Promise((resolve) => setTimeout(resolve, 150))
    const made = await board.tasks.create('work', 'just in time')
    const claim = await waiting
    expect(claim?.task.id).toBe(made.task.id)
    expect(Date.parse(claim!.until) - Date.now()).toBeGreaterThan(25 * SECOND)
    // With nothing coming, it gives up when its wait runs out.
    const started = Date.now()
    expect(await board.tasks.claim({ channel: 'work', wait: 0.4 })).toBeNull()
    expect(Date.now() - started).toBeGreaterThanOrEqual(350)
  })

  it('asks a board again, never holding one request past 25 seconds, and sends a claim with what it does', async () => {
    vi.useRealTimers()
    // A board that has nothing the first time it's asked, and a task the second.
    const asked: { path: string; body: any }[] = []
    const root = { id: '7', channel: 'work', text: 'fix CVE-123', task: { state: 'claimed' } }
    const stub = async (request: Request) => {
      asked.push({ path: new URL(request.url).pathname.replace('/api/board', ''), body: await request.json() })
      const claims = asked.filter((one) => one.path === '/tasks/claim').length
      if (asked.at(-1)!.path !== '/tasks/claim') return Response.json({ task: { ...root, task: { state: 'completed' } } })
      return Response.json(claims === 1 ? { task: null } : { task: root, claim: { epoch: 3, token: 'secret', until: '2026-10-07T12:15:00.000Z' } })
    }
    const team = projectBoard({ backend: http(BOARD_URL, { fetch: (input, init) => stub(new Request(input, init)) }) }).as(null)
    const claim = await team.tasks.claim({ channel: 'work/', label: { step: 'fix' }, from: ['ada'], wait: 60, lease: 300 })
    expect(claim).toMatchObject({ task: { id: '7' }, epoch: 3, token: 'secret', until: '2026-10-07T12:15:00.000Z' })
    expect(asked.map((one) => one.path)).toEqual(['/tasks/claim', '/tasks/claim'])
    expect(asked[0]!.body).toEqual({ channel: 'work/', label: { step: 'fix' }, from: ['ada'], lease: 300, wait: 25 })
    expect(asked[1]!.body.wait).toBe(25)
    expect((await claim!.complete('fixed in a1b2c3')).task?.state).toBe('completed')
    expect(asked[2]).toEqual({ path: '/tasks/7/complete', body: { epoch: 3, token: 'secret', result: 'fixed in a1b2c3' } })
  })
})

describe("a task's client id, from the board's own code", () => {
  it('makes a task once for a watcher that makes one and is run again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let runs = 0
    const intake: Watcher = {
      tail: 'intake',
      run: async ({ event, board }) => {
        if (event.type !== 'message.posted' || event.message?.re !== null) return
        await board.tasks.create('work', { text: `triage: ${event.message.text}`, labels: { step: 'triage' } })
        // Killed after its write, as a function that timed out is: the board runs it again.
        if (++runs === 1) throw new Error('timed out after it wrote')
      },
    }
    // No scheduler, so nothing retries on its own: each drain is the next try.
    const board = testBoard({ watch: { intake } })
    const ada = person(board, 'ada')
    await ada('POST', '/messages', { channel: 'intake', text: 'export times out past 10k rows' })
    const watches = board.servers.at(-1)!
    await vi.waitFor(async () => {
      await board.skipHold(watches, 'watch:intake')
      await watches.drain('watch:intake')
      expect(runs).toBe(2)
    })
    const { tasks } = (await ada('GET', '/tasks?channel=work&state=all')).body
    expect(tasks.map((t: { message: MessageView }) => [t.message.text, t.message.task?.owner])).toEqual([['triage: export times out past 10k rows', 'board:watch:intake']])
    error.mockRestore()
  })

  it("is its profile's own: the same id again is the same task, another profile's is another, and no request takes it first", async () => {
    const { board, ada } = setup()
    const hook = board.as('v0-hook')
    const first = await hook.tasks.create('work', { text: 'deploy a1b2c3', id: 'delivery-1' })
    const again = await board.as('v0-hook').tasks.create('work', { text: 'deploy a1b2c3', id: 'delivery-1' })
    expect(again.task.id).toBe(first.task.id)
    expect((await board.as('deploys').tasks.create('work', { text: 'deploy a1b2c3', id: 'delivery-1' })).task.id).not.toBe(first.task.id)
    // A request that posts with the same id first hasn't taken the hook's: its task is still made.
    expect((await ada('POST', '/tasks', { channel: 'work', text: 'mine now', id: 'delivery-2' })).status).toBe(201)
    const second = await hook.tasks.create('work', { text: 'deploy d4e5f6', id: 'delivery-2' })
    expect(second.task).toMatchObject({ text: 'deploy d4e5f6', task: { owner: 'board:client:v0-hook' } })
    expect((await ada('GET', '/tasks?channel=work')).body.tasks).toHaveLength(4)
  })
})

describe("the fold, for whoever folds the board's events themselves", () => {
  const by = { actor: ADA, principal: ADA, profile: null, session: null }
  const other = { actor: BO, principal: BO, profile: null, session: null }
  const until = at(15 * MINUTE)
  /** The board after `payloads`, a root at #1 and a reply at #2, then one event each from #3 on. */
  function folded(...payloads: [type: string, payload: object][]): MessagesState {
    const post = (re: number | null) => ({ channel: 'work', text: 'fix CVE-123', re, replyTo: null, thread: 'root', labels: {}, noSync: false, mentions: [], by, origin: null, from: null })
    const all: [string, object][] = [['message.posted', post(null)], ['message.posted', post(1)], ...payloads]
    const state: MessagesState = { byId: {}, replies: {} }
    all.forEach(([type, payload], i) => foldMessages(state, { index: i + 1, id: i === 0 ? 'root' : `e${i + 1}`, type, payload, createdAt: at(i * SECOND), sessionId: 'board' } as unknown as BoardEvent))
    return state
  }
  const about = { id: 1, thread: 'root' }
  const created: [string, object] = ['task.created', { ...about, needs: [], for: null, by }]
  const claimed = (epoch: number, who = by): [string, object] => ['task.claimed', { ...about, epoch, until, session: null, token: 'a'.repeat(64), by: who }]

  it('lets a write change nothing once its task has moved on: an older epoch, a finished task, a second creation', () => {
    // A claim's writes at an epoch the task has left.
    const taken = folded(created, claimed(1), ['task.expired', { ...about, epoch: 1 }], claimed(2, other), ['task.completed', { ...about, epoch: 1, result: 'late', by }], ['task.released', { ...about, epoch: 1, by }], ['task.renewed', { ...about, epoch: 1, until: at(60 * MINUTE), by }])
    expect(taken.byId[1]!.task).toMatchObject({ state: 'claimed', epoch: 2, claim: { actor: BO, until }, result: null })
    // The last event that changed it is the second claim: the stale ones aren't versions of it.
    expect(taken.byId[1]!.version).toBe(6)
    // A claim that skips an epoch, or lands on a task someone holds, isn't a claim.
    expect(folded(created, claimed(2)).byId[1]!.task).toMatchObject({ state: 'ready', epoch: 0, claim: null })
    expect(folded(created, claimed(1), claimed(2, other)).byId[1]!.task).toMatchObject({ epoch: 1, claim: { actor: ADA } })
    // A completed task stays completed, whatever is written to it after.
    const done = folded(created, claimed(1), ['task.completed', { ...about, epoch: 1, result: 'fixed', by }], ['task.canceled', { ...about, reason: 'deleted', by }], ['task.blocked', { ...about, kind: null, reason: 'hold', by }], ['task.reopened', { ...about, by }], ['task.failed', { ...about, epoch: 1, reason: 'no', by }])
    expect(done.byId[1]).toMatchObject({ labels: { 'board.task': 'completed' }, task: { state: 'completed', result: 'fixed', reason: null, blocked: null } })
    // Only a failed task reopens, and a thread is made a task once, by whoever did first.
    expect(folded(created, ['task.canceled', { ...about, reason: 'no', by }], ['task.reopened', { ...about, by }]).byId[1]!.task?.state).toBe('canceled')
    expect(folded(created, ['task.created', { ...about, needs: [], for: null, by: other }]).byId[1]!.task?.owner).toBe(ADA)
  })

  it('keeps tasks on roots that are there: a reply is no task, and a deleted root wears no label', () => {
    const reply = folded(['task.created', { id: 2, thread: 'root', needs: [], for: null, by }])
    expect(reply.byId[2]!.task).toBeUndefined()
    expect(reply.byId[2]!.labels).toEqual({})
    const gone = folded(['message.deleted', { ...about, by, from: null }], created)
    expect(gone.byId[1]!.task).toBeUndefined()
    // A task whose root went keeps its state, off the labels: nothing finds a tombstone by it.
    const canceled = folded(created, ['message.deleted', { ...about, by, from: null }], ['task.canceled', { ...about, reason: 'deleted', by }])
    expect(canceled.byId[1]).toMatchObject({ deleted: true, labels: {}, task: { state: 'canceled', reason: 'deleted' } })
  })
})
