import { idempotentId } from 'experimental-a2'
import { describe, expect, it } from 'vitest'
import type { Middleware } from '../src/server/index.ts'
import { caller, personToken, testBoard } from './harness.ts'

const pass: Middleware = async ({ next }) => next()

async function twoPeople(middleware?: Middleware[]) {
  const { fetch } = testBoard(middleware ? { middleware } : {})
  const ada = caller(fetch, await personToken('u_ada'), { 'x-board-handle': 'ada' })
  const julian = caller(fetch, await personToken('u_julian'), { 'x-board-handle': 'julian' })
  return { ada, julian }
}

describe('a post id', () => {
  for (const middleware of [undefined, [pass]]) {
    describe(middleware ? 'with middleware' : 'without middleware', () => {
      it("someone else used isn't a retry: 409 duplicate_id, not their message", async () => {
        const { ada, julian } = await twoPeople(middleware)
        const first = await ada('POST', '/messages', { channel: 'dev', text: 'deploy a1b2c3 is live', id: 'deploy-a1b2c3' })
        expect(first.status).toBe(201)
        const retry = await ada('POST', '/messages', { channel: 'dev', text: 'deploy a1b2c3 is live', id: 'deploy-a1b2c3' })
        expect(retry.body.message.id).toBe(first.body.message.id)

        const theirs = await julian('POST', '/messages', { channel: 'dev', text: 'rolling back a1b2c3', id: 'deploy-a1b2c3' })
        expect({ status: theirs.status, code: theirs.body.error?.code, message: theirs.body.message }).toEqual({
          status: 409,
          code: 'duplicate_id',
          message: undefined,
        })
      })

      it("used in another place isn't a retry", async () => {
        const { ada } = await twoPeople(middleware)
        const root = (await ada('POST', '/messages', { channel: 'dev', text: 'deploys' })).body.message
        expect((await ada('POST', '/messages', { channel: 'dev', text: 'a1b2c3 is live', id: 'live-a1b2c3' })).status).toBe(201)
        const reply = await ada('POST', '/messages', { re: root.id, text: 'a1b2c3 is live', id: 'live-a1b2c3' })
        expect([reply.status, reply.body.error?.code]).toEqual([409, 'duplicate_id'])
      })
    })
  }

  it("can't take an ID the board derives for its own writes", async () => {
    const { julian } = await twoPeople([pass])
    const send = await idempotentId('vboard-schedule', '1', '0')
    const taken = await julian('POST', '/messages', { channel: 'dev', text: 'not the reminder', id: send })
    expect([taken.status, taken.body.error?.code]).toEqual([400, 'invalid_request'])
    expect((await julian('POST', '/messages', { channel: 'dev', text: 'a v4 is fine', id: crypto.randomUUID() })).status).toBe(201)
  })
})
