import { describe, expect, it } from 'vitest'
import { createClient } from '../src/client/index.ts'
import { conformance } from '../src/conformance/index.ts'
import { BOARD_URL, personToken, testBoard } from './harness.ts'
import { fakeQueue } from './queue.ts'

type Fetch = (request: Request) => Promise<Response>

const clientOf = async (fetch: Fetch) =>
  createClient({
    url: BOARD_URL,
    token: await personToken(),
    handle: 'julian',
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => fetch(new Request(input, init))) as typeof globalThis.fetch,
  })

/** A board in front of `fetch` that rewrites what it answers, or what it's asked. */
function broken(fetch: Fetch, change: { request?: (url: URL) => void; body?: (text: string) => string }): Fetch {
  return async (request) => {
    const url = new URL(request.url)
    change.request?.(url)
    const response = await fetch(new Request(url, request))
    if (!change.body || !response.headers.get('content-type')?.includes('application/json')) return response
    return new Response(change.body(await response.text()), { status: response.status, headers: response.headers })
  }
}

describe('the conformance kit', () => {
  it('passes a board on a2(), checking each group it declares, and deletes what it posted', async () => {
    const board = testBoard({ scheduler: fakeQueue().scheduler })
    const client = await clientOf(board.fetch)
    const report = await conformance(client)
    expect(report.checks.filter((check) => check.status === 'failed')).toEqual([])
    expect(report).toMatchObject({ ok: true, url: BOARD_URL, capabilities: ['schedules', 'attachments', 'watchers', 'stuck'] })
    expect([...new Set(report.checks.map((check) => check.group))]).toEqual(['core', 'schedules', 'attachments', 'watchers', 'stuck'])
    expect(report.checks.find((check) => check.group === 'stuck')).toMatchObject({ name: "lists what's stuck", status: 'passed' })
    const { messages } = await client.messages({ channel: 'conformance', limit: 500 })
    expect(messages.filter((message) => !message.deleted)).toEqual([])
  })

  it("leaves out a group the board doesn't declare", async () => {
    const report = await conformance(await clientOf(testBoard().fetch))
    expect(report.capabilities).not.toContain('schedules')
    expect(report.checks.some((check) => check.group === 'schedules')).toBe(false)
    expect(report.ok).toBe(true)
  })

  it('fails a board that shows its IDs as numbers', async () => {
    const board = testBoard()
    const numeric = broken(board.fetch, { body: (text) => text.replace(/"(id|re)":"(\d+)"/g, '"$1":$2') })
    const report = await conformance(await clientOf(numeric))
    expect(report.ok).toBe(false)
    expect(report.checks.find((check) => check.name === 'posts a message, and reads it back by its ID')).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining("a message's id should be a string of 1 to 128 characters, got 2"),
    })
  })

  it("fails a board whose reads ignore where they're asked to start", async () => {
    const board = testBoard()
    const ignoring = broken(board.fetch, { request: (url) => url.pathname.endsWith('/messages') && url.searchParams.delete('after') })
    const report = await conformance(await clientOf(ignoring))
    expect(report.checks.filter((check) => check.status === 'failed').map((check) => [check.name, check.detail])).toEqual([
      ['reads a channel after a cursor or a message ID, oldest first', 'reading after a message should leave it out'],
    ])
  })

  it('reports a board whose discovery says nothing of what it does', async () => {
    const board = testBoard()
    const old = broken(board.fetch, { body: (text) => text.replace(/,"capabilities":\[[^\]]*\]/, '') })
    const report = await conformance(await clientOf(old))
    expect(report).toMatchObject({ ok: false, checks: [{ name: 'says in its discovery what it does', status: 'failed', detail: 'capabilities should be a list, got undefined' }] })
  })
})
