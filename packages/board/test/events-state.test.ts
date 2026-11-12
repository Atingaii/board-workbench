import { describe, expect, it } from 'vitest'
import { compileAccess, InvalidCan, PERMISSIONS } from '../src/access/index.ts'
import { http } from '../src/backend-http/index.default.ts'
import { createBoardClient } from '../src/client/client.ts'
import { board, type EventsState, type ExplainPrincipal } from '../src/server/index.default.ts'

// What a UI on a handle needs beside the data: whether the feed is connected, the permission
// names a grant takes, and the type of the principal `explain` asks about.

const URL_ = 'https://board.example/api/board'
const event = { cursor: '2', type: 'channel.created', createdAt: '2026-10-01T00:00:00.000Z', payload: { channel: 'dev', by: { actor: 'vercel:user:u_julian', principal: 'vercel:user:u_julian', profile: null } } }

/** A board elsewhere whose `/events` answers in turn, then holds the request until it's aborted. Every other route's request is kept. */
function remote(answers: (() => Response)[]) {
  const asked: string[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!url.pathname.endsWith('/events')) {
      asked.push(`${url.pathname.slice('/api/board'.length)}${url.search}`)
      return Response.json({ channel: 'dev', pattern: null, over: [], level: null, grants: [], capped: null, can: [] })
    }
    const answer = answers.shift()
    if (answer) return answer()
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  }) as typeof globalThis.fetch
  return { fetch, asked }
}

const down = () => {
  throw new TypeError('fetch failed')
}

describe('events, told whether it is connected', () => {
  it("tells a handle's onState live when a poll goes out, retrying while they fail, and live again once one is answered", async () => {
    const { fetch } = remote([down, down, () => Response.json({ events: [event], cursor: '2' })])
    const team = board({ backend: http(URL_, { fetch }) })
    const states: EventsState[] = []
    const stop = new AbortController()
    const events = team.events({ all: true, after: '1' }, { signal: stop.signal, onState: (state) => states.push(state) })
    const first = await events.next()
    stop.abort()
    expect(first.value).toMatchObject({ type: 'channel.created', cursor: '2' })
    // Each change once: the second failure isn't news, and a retry going out isn't live until it's answered.
    expect(states).toEqual(['live', 'retrying', 'live'])
  }, 10_000)

  it('tells a client on the stream the same', async () => {
    const stream = () => new Response(`id: 2\nevent: board\ndata: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    const { fetch } = remote([down, stream])
    const client = createBoardClient({ url: URL_, fetch })
    const states: EventsState[] = []
    const stop = new AbortController()
    const events = client.events({ after: '1' }, { signal: stop.signal, onState: (state) => states.push(state) })
    const first = await events.next()
    stop.abort()
    expect(first.value).toMatchObject({ type: 'channel.created' })
    expect(states).toEqual(['live', 'retrying', 'live'])
  }, 10_000)

  it('follows without an onState as before', async () => {
    const { fetch } = remote([() => Response.json({ events: [event], cursor: '2' })])
    const stop = new AbortController()
    const first = await board({ backend: http(URL_, { fetch }) }).events({ after: '1' }, { signal: stop.signal }).next()
    stop.abort()
    expect(first.value).toMatchObject({ cursor: '2' })
  })
})

describe('what a grant form takes from the package', () => {
  it('lists the permission names a grant takes, from @vercel/board/access', () => {
    // Each is one a `can` takes, all of them together are full access, and nothing else is one.
    for (const permission of PERMISSIONS) expect(compileAccess([permission]).anywhere(permission)).toBe(true)
    expect(compileAccess({ '*': [...PERMISSIONS] }).everywhere('manage')).toBe(true)
    expect(PERMISSIONS).toContain('manage')
    expect(() => compileAccess(['shout' as (typeof PERMISSIONS)[number]])).toThrow(InvalidCan)
  })

  it('types the principal explain asks about, from the root', async () => {
    const { fetch, asked } = remote([])
    const whom: ExplainPrincipal = { project: 'web', environment: 'preview' }
    await board({ backend: http(URL_, { fetch }) }).explain('dev', whom)
    expect(asked.at(-1)).toBe('/grants/explain?channel=dev&project=web&environment=preview')
  })
})
