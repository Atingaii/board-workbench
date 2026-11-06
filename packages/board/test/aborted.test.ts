import { afterEach, describe, expect, it, vi } from 'vitest'
import { a2 } from '../src/server/a2.ts'
import type { Backend } from '../src/server/backend.ts'
import { memory } from '../src/store/memory.ts'
import { oidcTokens } from '../src/access/index.ts'
import { board, BOARD_URL, personToken, testAuth } from './harness.ts'

/** A board on the local engine, but with `events` as given. */
function boardWith(events: Backend['events']) {
  const inner = a2({ store: memory() })
  const backend = new Proxy(inner, { get: (target, key, receiver) => (key === 'events' ? events : Reflect.get(target, key, receiver)) })
  return board({ backend, authenticate: oidcTokens(testAuth), url: BOARD_URL })
}

/**
 * `events` that holds until the request it serves is stopped, then fails as `stopped` says: with
 * the abort itself, as a backend whose API calls the request's signal stops does (`vercel()`'s
 * long-poll), or with something else.
 */
const heldUntilStopped =
  (stopped: (signal: AbortSignal) => unknown): Backend['events'] =>
  (_caller, _query, signal) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(stopped(signal)), { once: true }))

/** A long-poll, as the inspector's page sends one, whose caller stops it a moment in, or doesn't. */
async function longPoll(served: ReturnType<typeof board>, { stop }: { stop: boolean }) {
  const caller = new AbortController()
  const answer = served.fetch(
    new Request(`${BOARD_URL}/events?wait=25`, { headers: { authorization: `Bearer ${await personToken('u_julian', BOARD_URL)}` }, signal: caller.signal }),
  )
  if (stop) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    caller.abort()
  }
  return answer
}

describe('a request its caller stops', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("isn't the board's failure: nothing logs it, where a backend's own failure logs", async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await longPoll(boardWith(heldUntilStopped((signal) => signal.reason)), { stop: true })
    expect(logged).not.toHaveBeenCalled()
    // A failure of the backend's own, its caller still there: an internal error, logged.
    const answered = await longPoll(boardWith(() => Promise.reject(new TypeError('the API broke'))), { stop: false })
    expect(answered.status).toBe(500)
    expect(logged).toHaveBeenCalledWith('[board]', expect.objectContaining({ message: 'the API broke' }))
  })

  it('still logs a failure that is no abort, though its caller went away too', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await longPoll(boardWith(heldUntilStopped(() => new TypeError('the API broke as the caller left'))), { stop: true })
    expect(logged).toHaveBeenCalledWith('[board]', expect.objectContaining({ message: 'the API broke as the caller left' }))
  })
})
