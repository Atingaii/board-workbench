import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ScheduleView } from '../src/api/routes.ts'

// The page's data module, as the page runs it: one handle on the inspector's proxy, which is
// faked here. What the page asks the board, and what it keeps, are what a person at it sees.

type Asked = { method: string; path: string; body: unknown }
const asked: Asked[] = []
/** What the board answers next for a route, by `METHOD /path`: each is used once, then the route's usual answer. */
const next = new Map<string, (() => Response)[]>()
const refuse = (status: number, code: string, message: string) => () => Response.json({ error: { code, message } }, { status })

const schedule = (text: string): ScheduleView =>
  ({ id: 's1', channel: 'dev', re: null, text, labels: {}, noSync: false, attachments: [], first: '2026-10-01T12:00:00.000Z', every: null, until: null, times: null, sent: 0, next: '2026-10-01T12:00:00.000Z', last: null, state: 'pending', canceled: null, createdAt: '2026-10-01T10:00:00.000Z' }) as unknown as ScheduleView

const usual: Record<string, (body: unknown) => Response> = {
  'POST /attachments': () => Response.json({ attachment: { id: 'a'.repeat(22), name: 'trace.log', type: 'text/plain', size: 5 } }, { status: 201 }),
  'POST /schedules': (body) => Response.json({ schedule: schedule((body as { text: string }).text) }, { status: 201 }),
  'GET /schedules': () => Response.json({ schedules: [] }),
}

let page: typeof import('../src/inspect/app/board.ts')

beforeAll(async () => {
  // What a browser gives the page: where it is, its document, and a fetch, which here is the proxy.
  vi.stubGlobal('document', { querySelector: () => null })
  vi.stubGlobal('location', { origin: 'http://127.0.0.1:4747' })
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
  vi.stubGlobal('addEventListener', () => {})
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname.slice('/board'.length)
    const method = request.method
    // What it carries, when that's JSON: a file's bytes are not.
    const body = await request
      .text()
      .then((text) => (text ? (JSON.parse(text) as unknown) : null))
      .catch(() => null)
    asked.push({ method, path, body })
    const route = `${method} ${path}`
    return next.get(route)?.shift()?.() ?? usual[route]?.(body) ?? Response.json({ error: { code: 'not_found', message: `no ${route} here` } }, { status: 404 })
  })
  page = await import('../src/inspect/app/board.ts')
})

const posts = (path: string) => asked.filter((request) => request.method === 'POST' && request.path === path).map((request) => request.body)

describe("the inspector's page, sending later", () => {
  it('keeps a schedule the board refused, with everything typed, and schedules it again on retry', async () => {
    next.set('POST /schedules', [refuse(403, 'forbidden', "this token can't post in dev")])
    const file = new File(['trace'], 'trace.log', { type: 'text/plain' })
    await page.send({ channel: 'dev', re: null, text: 'Morning recap', noSync: true, labels: { kind: 'recap' }, files: [file], later: { in: '2h', every: '1d' } })

    // Nothing is lost: it's a post that didn't go, as a refused send is, with why and what it would have sent.
    const [kept] = page.getState().pending
    expect(kept).toMatchObject({
      channel: 'dev',
      re: null,
      text: 'Morning recap',
      noSync: true,
      labels: { kind: 'recap' },
      files: [{ name: 'trace.log', size: 5 }],
      later: { in: '2h', every: '1d' },
      error: "this token can't post in dev",
    })
    expect(page.getState().pending).toHaveLength(1)

    await page.retry(kept!)
    // The retry asked for the same schedule, its file with it, and the board kept it: nothing is pending.
    expect(page.getState().pending).toEqual([])
    const wanted = { channel: 'dev', text: 'Morning recap', noSync: true, labels: { kind: 'recap' }, attachments: ['a'.repeat(22)], in: '2h', every: '1d' }
    expect(posts('/schedules')).toEqual([wanted, wanted])
    // A schedule is not a post: nothing was sent to the channel on the way.
    expect(posts('/messages')).toEqual([])
  })

  it('leaves no pending post behind a schedule the board kept, and a reply later names its thread', async () => {
    asked.length = 0
    await page.send({ channel: 'dev', re: '812', text: 'Still broken?', noSync: false, labels: {}, later: { at: '2026-10-02T09:00:00.000Z' } })
    expect(page.getState().pending).toEqual([])
    expect(posts('/schedules')).toEqual([{ re: '812', text: 'Still broken?', at: '2026-10-02T09:00:00.000Z' }])
  })

  it('discards one you give up on', async () => {
    next.set('POST /schedules', [refuse(400, 'invalid_request', 'durations look like 30s, 30m, 12h, or 1d')])
    await page.send({ channel: 'dev', re: null, text: 'Typo', noSync: false, labels: {}, later: { in: '2h' } })
    const [kept] = page.getState().pending
    expect(kept).toMatchObject({ text: 'Typo', error: 'durations look like 30s, 30m, 12h, or 1d' })
    page.discard(kept!.key)
    expect(page.getState().pending).toEqual([])
  })
})
