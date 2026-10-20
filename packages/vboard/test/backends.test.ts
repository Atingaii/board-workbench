import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../src/client/node.ts'
import { memory } from '../src/store/memory.ts'
import { a2, board, http, vercelProject } from '../src/server/index.ts'
import { BOARD_URL, caller, deploymentToken, personToken, testBoard } from './harness.ts'

/** Where v0's board is mounted: a board on the team's board, over http(). */
const V0_URL = 'https://v0.test/api/board'
const V0 = 'vercel:project:prj_v0:production'

/** The team's board, and v0's board using it over http(), calling each other in-process. */
function team() {
  const remote = testBoard({ access: [vercelProject({ project: 'prj_v0', can: 'all' }), vercelProject({ project: 'prj_marketing', can: 'all' })] })
  const route = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    if (request.url.startsWith(BOARD_URL)) return remote.fetch(request)
    return Promise.resolve(new Response('no such host', { status: 502 }))
  }
  const project = board({
    backend: http(BOARD_URL, { fetch: route as typeof fetch, token: () => deploymentToken('v0', 'prj_v0', 'production') }),
    url: V0_URL,
  })
  return { remote, project }
}

const julianOn = async (fetch: (request: Request) => Promise<Response>) => caller(fetch, await personToken(), { 'x-board-handle': 'julian' })

describe('board() and its backend', () => {
  it('says where options moved, and what a board without a backend needs', () => {
    expect(() => board({ store: memory() } as never)).toThrow('board: store goes in a2(): board({ backend: a2({ store }) })')
    expect(() => board({ store: memory(), sync: {} } as never)).toThrow('board: store, sync go in a2(): board({ backend: a2({ store, sync }) })')
    expect(() => board({ remote: BOARD_URL } as never)).toThrow("board: remote is now a backend: board({ backend: http('<url>') })")
    expect(() => board({} as never)).toThrow('board: no backend: pass a2({ store, … }) to keep the board here, or http(url) to use one elsewhere')
    expect(() => http('board.example.com')).toThrow("http: board.example.com isn't a URL")
  })

  it('keeps the board here with a2()', async () => {
    const here = board({ backend: a2({ store: memory() }), url: BOARD_URL })
    const discovery = await (await here.fetch(new Request(BOARD_URL))).json()
    expect(discovery).toMatchObject({ url: BOARD_URL })
    expect(discovery.remote).toBeUndefined()
    // a2()'s own extras ride along: its A2 servers, for a shared scheduler.
    expect(here.servers.length).toBeGreaterThan(0)
  })
})

describe('a board on http()', () => {
  it('keeps no log, and sends clients to the board it uses', async () => {
    // With a token in the environment, a client skips discovery; this is the one without.
    vi.stubEnv('VBOARD_TOKEN', '')
    const { project } = team()
    const discovery = await (await project.fetch(new Request(V0_URL))).json()
    expect(discovery).toMatchObject({ url: V0_URL, remote: BOARD_URL })

    expect(await caller(project.fetch, await personToken())('GET', '/messages')).toEqual({
      status: 404,
      body: { error: { code: 'remote', message: `this board keeps no log: use ${BOARD_URL}` } },
    })
    expect((await project.scheduler(new Request(`${V0_URL}/scheduler`, { method: 'POST' }))).status).toBe(404)

    const route = (input: RequestInfo | URL, init?: RequestInit) => project.fetch(new Request(input, init))
    await expect(createClient({ url: V0_URL, fetch: route as typeof fetch }).me()).rejects.toThrow(`${V0_URL} keeps no log: use ${BOARD_URL}`)
    vi.unstubAllEnvs()
  })

  it('writes from your own code as its deployment, idempotent by key', async () => {
    const { remote, project } = team()
    await project.client('deploys', { key: 'd1' }).post('deploys', 'a1b2c3 is live')
    await project.client('deploys', { key: 'd1' }).post('deploys', 'a1b2c3 is live')
    await project.client('deploys', { key: 'd2' }).post('deploys', 'd4e5f6 is live')
    expect(() => project.client('deploy_bot')).toThrow('client: deploy_bot: names start with a letter')

    const { body } = await (await julianOn(remote.fetch))('GET', '/messages?channel=deploys')
    expect(body.messages.map((message: { text: string; by: { actor: string } }) => [message.text, message.by.actor])).toEqual([
      ['a1b2c3 is live', `${V0}+deploys`],
      ['d4e5f6 is live', `${V0}+deploys`],
    ])
  })

  it("keeps a client's keyed post IDs its own, so no one can take one first", async () => {
    const { remote, project } = team()
    const marketing = caller(remote.fetch, await deploymentToken('marketing', 'prj_marketing', 'production'))
    const taken = await marketing('POST', '/messages', { channel: 'deploys', text: 'mine now', id: `key:${V0}:0123456789abcdef0123456789abcdef` })
    expect(taken).toEqual({
      status: 400,
      body: {
        error: {
          code: 'invalid_request',
          message: `id: key:… IDs derive from a client's key, and this token's are key:vercel:project:prj_marketing:production:…`,
        },
      },
    })
    expect((await marketing('POST', '/messages', { channel: 'deploys', text: 'fine', id: 'key:vercel:project:prj_marketing:production:abc' })).status).toBe(201)
    // v0's own keyed post still lands, under its own principal.
    expect((await project.client('deploys', { key: 'd1' }).post('deploys', 'a1b2c3 is live')).id).toEqual(expect.any(Number))
  })

  it("doesn't run watchers yet", () => {
    expect(() => board({ backend: http(BOARD_URL), watch: { fix: { tail: 'feedback', run: () => {} } } })).toThrow(
      "board: watchers don't run over http() yet: keep them on an a2() board for now",
    )
  })
})
