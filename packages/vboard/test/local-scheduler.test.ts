import { contract } from 'experimental-a2'
import { consumer, createServer } from 'experimental-a2/server'
import { memory } from 'experimental-a2/store-memory'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { localScheduler } from '../src/scheduler/local.ts'

const pings = contract({
  name: 'local-scheduler-test',
  events: { ping: z.object({ n: z.number() }), pong: z.object({ n: z.number() }) },
})

function setup(failures = 0) {
  const scheduler = localScheduler()
  const seen: number[] = []
  let left = failures
  const answer = consumer({ contract: pings, name: 'answer', types: ['ping'] }).run(async ({ event }) => {
    if (left-- > 0) throw new Error('not yet')
    seen.push(event.payload.n)
  })
  const server = createServer({ contract: pings, store: memory(), scheduler, consumers: [answer] })
  scheduler.handler(server)
  return { server, seen }
}

describe('the local scheduler', () => {
  it("retries a consumer that failed, without waiting for the session's next write", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { server, seen } = setup(1)
    await server.session('s').append({ type: 'ping', payload: { n: 1 } })
    // A2's retry rides the drain it armed with the append, about 6 seconds on.
    await vi.waitFor(() => expect(seen).toEqual([1]), { timeout: 10_000 })
    error.mockRestore()
  }, 15_000)

  it('delivers a timer at its time', async () => {
    const { server } = setup()
    const session = server.session('s')
    for (let i = 0; i < 3; i++) await session.schedule('later', { delay: '1s' }, { type: 'pong', payload: { n: 2 } })
    expect((await session.history()).filter((event) => event.type === 'pong')).toEqual([])
    await vi.waitFor(async () => expect((await session.history()).filter((event) => event.type === 'pong')).toHaveLength(1), { timeout: 4000 })
  })
})
