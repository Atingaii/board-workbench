import { randomBytes } from 'node:crypto'
import { A2Error, idempotentId, reducer, type ContractEvent } from 'experimental-a2'
import type { BoardEventView, MatchView } from '../api/routes.ts'
import { watchContract, type WatchEvents } from '../contract/contract.ts'
import type { Access } from './access.ts'

/**
 * Registered watchers' matches, as a queue per watcher and thread in their registrant's session
 * (`watch:@<principal>`): the registrant pulls a thread's oldest match, runs it, and acks it, and
 * the thread's next match waits until then. Nothing is pushed but a wake-up with no event in it.
 */

/** Tries before a match is given up on, as a watcher's own runs are. */
export const MATCH_TRIES = 5
/** How long a pulled match is its puller's before someone may pull it again. */
export const LEASE_MS = 5 * 60_000
/** After an error, a match waits 1 second, doubling to 30. */
export const retryDelay = (attempts: number) => Math.min(30_000, 1000 * 2 ** (attempts - 1))

type Pending = {
  id: string
  watcher: string
  thread: string
  event: unknown
  /** Tries that ended without finishing: errors and leases that ran out. */
  attempts: number
  lease: { id: string; until: number } | null
  /** After an error, when it may be pulled again. */
  retryAt: number | null
}

export type QueueState = {
  /** `<watcher>\u001f<thread>` → match IDs, oldest first: only the first is ever handed out. */
  queues: Record<string, string[]>
  pending: Record<string, Pending>
}

const queueKey = (watcher: string, thread: string) => `${watcher}\u001f${thread}`

function remove(state: QueueState, id: string) {
  const found = state.pending[id]
  if (!found) return
  delete state.pending[id]
  const key = queueKey(found.watcher, found.thread)
  const rest = (state.queues[key] ?? []).filter((queued) => queued !== id)
  if (rest.length > 0) state.queues[key] = rest
  else delete state.queues[key]
}

function foldQueue(state: QueueState, event: ContractEvent<WatchEvents>): QueueState {
  switch (event.type) {
    case 'watch.matched': {
      const { watcher, thread } = event.payload
      // A config watcher's match runs in-process; only registered ones queue here.
      if (watcher === undefined || state.pending[event.id]) return state
      state.pending[event.id] = { id: event.id, watcher, thread, event: event.payload.event, attempts: 0, lease: null, retryAt: null }
      ;(state.queues[queueKey(watcher, thread)] ??= []).push(event.id)
      return state
    }
    case 'watch.leased': {
      const found = state.pending[event.payload.matched]
      if (found && !found.lease) found.lease = { id: event.payload.lease, until: event.payload.until }
      return state
    }
    case 'watch.acked': {
      const found = state.pending[event.payload.matched]
      // An ack under a lease that's no longer the match's changes nothing.
      if (!found || found.lease?.id !== event.payload.lease) return state
      if (event.payload.error === undefined) {
        remove(state, found.id)
        return state
      }
      found.attempts += 1
      found.lease = null
      found.retryAt = event.payload.retryAt ?? null
      return state
    }
    case 'watch.expired': {
      const found = state.pending[event.payload.matched]
      if (!found || found.lease?.id !== event.payload.lease) return state
      found.attempts += 1
      found.lease = null
      return state
    }
    case 'watch.retry': {
      const found = state.pending[event.payload.matched]
      if (found) found.retryAt = null
      return state
    }
    case 'watch.failed':
    case 'watch.skipped':
      remove(state, event.payload.matched)
      return state
    default:
      return state
  }
}

export const queueReducer = reducer({
  contract: watchContract,
  name: 'vboard.watch-queue.v1',
  initialState: { queues: {}, pending: {} } as QueueState,
}).fold(foldQueue)

/** The parts of an A2 session of the watch contract that the queue uses. */
type QueueSession = {
  state(r: typeof queueReducer): Promise<{ state: QueueState }>
  append(...events: Parameters<WatchAppend>): Promise<unknown>
  schedule(name: string, timing: { at: Date }, ...events: Parameters<WatchAppend>): Promise<void>
}
type WatchAppend = (event: { type: string; id?: string; payload: unknown }) => Promise<unknown>

const describe = (error: unknown) => ((error instanceof Error ? error.message : String(error)) || 'unknown error').slice(0, 500)

/** Whether `access` may see `event` now, as it was matched: a message's channel, or every channel for none. */
function readable(access: Access, event: unknown) {
  const channel = (event as BoardEventView).message?.channel
  return channel === undefined ? access.readsAll : access.readable(channel)
}

/**
 * Hands out what the registrant may run now: each queue's oldest match, if no one holds it and
 * its wait after an error is over, leased to this pull. A lease or wait whose time has passed
 * counts as over even before its timer fires.
 */
export async function pull(
  session: QueueSession,
  options: { access: Access; limit: number; now: number; timers: boolean },
): Promise<MatchView[]> {
  const { state } = await session.state(queueReducer)
  const handed: MatchView[] = []
  for (const ids of Object.values(state.queues)) {
    if (handed.length >= options.limit) break
    const head = state.pending[ids[0]!]!
    if (head.lease && head.lease.until > options.now) continue
    if (head.retryAt !== null && head.retryAt > options.now) continue
    let attempts = head.attempts
    if (head.lease) {
      // It ran out before its timer said so: a try that didn't finish.
      await session.append({ type: 'watch.expired', payload: { matched: head.id, lease: head.lease.id } })
      attempts += 1
      if (attempts >= MATCH_TRIES) {
        await giveUp(session, head, `its lease ran out ${attempts} times`)
        continue
      }
    }
    if (!readable(options.access, head.event)) {
      await session.append({ type: 'watch.skipped', payload: { matched: head.id, reason: "its registrant can't read it anymore" } })
      continue
    }
    const lease = randomBytes(16).toString('hex')
    const until = options.now + LEASE_MS
    try {
      // Two pulls at once derive the same ID for this try, and only one lands.
      await session.append({
        type: 'watch.leased',
        id: await idempotentId('vboard-lease', head.id, String(attempts)),
        payload: { matched: head.id, lease, until },
      })
    } catch (error) {
      if (error instanceof A2Error && error.code === 'PARTIAL_DUPLICATE_BATCH') continue
      throw error
    }
    const { state: after } = await session.state(queueReducer)
    if (after.pending[head.id]?.lease?.id !== lease) continue
    if (options.timers)
      await session.schedule(`lease:${lease}`, { at: new Date(until) }, { type: 'watch.due', payload: { matched: head.id, lease } })
    handed.push({ id: head.id, watcher: head.watcher, thread: head.thread, lease, attempt: attempts, event: head.event as BoardEventView })
  }
  return handed
}

/** Records how a pulled match went: done, skipped, or an error that waits, then tries again. */
export async function ack(
  session: QueueSession,
  id: string,
  body: { lease: string; error?: string | undefined; skip?: boolean | undefined },
  options: { now: number; timers: boolean },
): Promise<'acked' | 'stale' | 'gone'> {
  const { state } = await session.state(queueReducer)
  const found = state.pending[id]
  if (!found) return 'gone'
  if (found.lease?.id !== body.lease) return 'stale'
  if (body.skip) {
    await session.append({ type: 'watch.skipped', payload: { matched: id, reason: 'its board skipped it' } })
    return 'acked'
  }
  if (body.error === undefined) {
    await session.append({ type: 'watch.acked', payload: { matched: id, lease: body.lease } })
    return 'acked'
  }
  const attempts = found.attempts + 1
  if (attempts >= MATCH_TRIES) {
    await session.append({ type: 'watch.acked', payload: { matched: id, lease: body.lease, error: body.error } })
    await giveUp(session, found, body.error)
    return 'acked'
  }
  const retryAt = options.now + retryDelay(attempts)
  await session.append({ type: 'watch.acked', payload: { matched: id, lease: body.lease, error: body.error, retryAt } })
  if (options.timers)
    await session.schedule(`retry:${id}:${attempts}`, { at: new Date(retryAt) }, { type: 'watch.due', payload: { matched: id, retry: true } })
  return 'acked'
}

/**
 * A timer came due: a lease ran out, or a match's wait is over. Returns whether the registrant
 * now has something to pull, so its board should be woken.
 */
export async function due(session: QueueSession, payload: { matched: string; lease?: string | undefined; retry?: boolean | undefined }): Promise<boolean> {
  const { state } = await session.state(queueReducer)
  const found = state.pending[payload.matched]
  if (!found) return false
  if (payload.lease !== undefined) {
    if (found.lease?.id !== payload.lease) return false
    await session.append({ type: 'watch.expired', payload: { matched: found.id, lease: payload.lease } })
    if (found.attempts + 1 >= MATCH_TRIES) {
      await giveUp(session, found, `its lease ran out ${found.attempts + 1} times`)
      return false
    }
    return true
  }
  if (payload.retry && found.retryAt !== null) {
    await session.append({ type: 'watch.retry', payload: { matched: found.id } })
    return true
  }
  return false
}

async function giveUp(session: QueueSession, found: Pending, error: string) {
  console.error(`[vboard] a registered watcher ${found.watcher} gave up on a match after ${MATCH_TRIES} tries:`, error)
  await session.append({ type: 'watch.failed', payload: { matched: found.id, thread: found.thread, error: describe(error) } })
}
