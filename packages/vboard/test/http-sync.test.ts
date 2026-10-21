import { describe, expect, it, vi } from 'vitest'
import { board, type Middleware } from '../src/server/index.ts'
import { vercelProject } from '../src/access/index.ts'
import { http } from '../src/backend-http/index.ts'
import { slack } from '../src/sync/slack.ts'
import { fakePlatform } from './sync-fixtures.ts'
import { BOARD_URL, caller, deploymentToken, personToken, PROJECT_ID, TEAM_ID, testAuth, testBoard } from './harness.ts'
import { fakeQueue } from './queue.ts'

/** Where the support project's board is mounted: a board on the team's, over http(), that syncs Slack itself. */
const SUPPORT_URL = 'https://support.test/api/board'
const SUPPORT = 'vercel:project:prj_support:production'
const supportToken = () => deploymentToken('support', 'prj_support', 'production')

type Read = { id: string; text: string; from: string | null; by: { actor: string }; origin: { thread: string; message: string } | null; reactions: Record<string, string[]> }

/**
 * The team's board on a2(), and the support project's board on http() using it with Slack synced,
 * calling each other in-process: the team's board wakes the project's at `<SUPPORT_URL>/wake`, and the
 * project's pushes, pulls, and writes back over HTTP. The project may do everything in `can`.
 */
function setup(options: { can?: Parameters<typeof vercelProject>[0]['can']; channels?: Record<string, string>; middleware?: Middleware[] } = {}) {
  const queue = fakeQueue()
  const s = fakePlatform('slack')
  let project: ReturnType<typeof board>
  const route = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    if (request.url.startsWith(BOARD_URL)) return team.fetch(request)
    if (request.url.startsWith(SUPPORT_URL)) return project.fetch(request)
    return Promise.resolve(new Response('no such host', { status: 502 }))
  }
  const team = testBoard({
    scheduler: queue.scheduler,
    access: [vercelProject({ project: 'prj_support', can: options.can ?? 'all' })],
    transport: { post: (url, init) => route(url, { method: 'POST', headers: init.headers, body: init.body }) },
  })
  const backend = http(BOARD_URL, { fetch: route as typeof fetch, token: supportToken })
  project = board({
    backend,
    url: SUPPORT_URL,
    // People sign in to it as to the team's: the same project, the same principals.
    project: { id: PROJECT_ID, teamId: TEAM_ID },
    auth: testAuth,
    sync: { slack: slack({ adapter: s.adapter, channels: options.channels ?? { C1: 'firehose' } }) },
    ...(options.middleware ? { middleware: options.middleware } : {}),
  })
  const webhook = (body: unknown) =>
    project.fetch(new Request(`${SUPPORT_URL}/webhooks/slack`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { team, project, backend, s, webhook, queue }
}

const julianOn = async (fetch: (request: Request) => Promise<Response>, audience?: string) =>
  caller(fetch, await personToken('u_julian', audience), { 'x-board-handle': 'julian' })

const read = async (call: ReturnType<typeof caller>, channel: string) => (await call('GET', `/messages?channel=${channel}`)).body.messages as Read[]

describe('sync on a board on http()', () => {
  it("imports a webhook onto the board it uses, as the Slack author, with the message's origin", async () => {
    const { team, webhook } = setup()
    const julian = await julianOn(team.fetch)
    expect((await webhook({ type: 'message', threadId: 'slack:C1:100', id: '100', text: 'export is broken', user: 'U_ADA' })).status).toBe(200)
    await vi.waitFor(async () => expect(await read(julian, 'firehose')).toHaveLength(1))
    const [root] = await read(julian, 'firehose')
    expect(root).toMatchObject({ text: 'export is broken', from: 'slack', by: { actor: 'slack:user:U_ADA' }, origin: { thread: 'slack:C1:100', message: '100' } })

    // A reply in the Slack thread lands in the board thread, and Slack's retry of it doesn't land twice.
    const reply = { type: 'message', threadId: 'slack:C1:100', id: '101', text: 'same here', user: 'U_BOB' }
    await webhook(reply)
    await webhook(reply)
    await vi.waitFor(async () => expect((await julian('GET', `/messages/${root!.id}`)).body.replies.map((r: Read) => [r.text, r.by.actor])).toEqual([['same here', 'slack:user:U_BOB']]))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await julian('GET', `/messages/${root!.id}`)).body.replies).toHaveLength(1)
    // What it pushed is in the inbox there, once each, for whoever may sync everywhere.
    const { body } = await julian('GET', '/inbox/slack')
    expect(body.events.map((event: { channel: string; event: { message: string } }) => `${event.channel}|${event.event.message}`).sort()).toEqual(['slack:C1|100', 'slack:C1|101'])
  })

  it("delivers a post on the board it uses to Slack, and records the delivery's receipt there", async () => {
    const { team, backend, s } = setup()
    await backend.register()
    const julian = await julianOn(team.fetch)
    const root = (await julian('POST', '/messages', { channel: 'firehose', text: 'deploy failed' })).body.message
    await vi.waitFor(() => expect(s.channelPosts.map((post) => [post.channelId, post.text])).toEqual([['slack:C1', JSON.stringify({ markdown: '**julian**: deploy failed' })]]))
    const receipt = async (id: string) =>
      ((await julian('GET', '/events?after=0&all=true')).body.events as { type: string; payload: { id?: string; target?: string; external?: { message: string } } }[]).find(
        (event) => event.type === 'message.synced' && event.payload.id === id,
      )
    await vi.waitFor(async () => expect(await receipt(root.id)).toMatchObject({ payload: { target: 'slack:C1', external: { message: s.channelPosts[0]!.id } } }))

    // A reply follows it into its Slack thread.
    const reply = (await julian('POST', '/messages', { re: root.id, text: 'rolled back' })).body.message
    await vi.waitFor(() => expect(s.posts.map((post) => [post.threadId, post.text])).toEqual([[`slack:C1:${s.channelPosts[0]!.id}`, JSON.stringify({ markdown: '**julian**: rolled back' })]]))
    await vi.waitFor(async () => expect(await receipt(reply.id)).toBeDefined())
  })

  it('follows edits and reactions both ways', async () => {
    const { team, backend, s, webhook } = setup()
    await backend.register()
    const julian = await julianOn(team.fetch)
    // From Slack: a message, then its edit and a reaction.
    await webhook({ type: 'message', threadId: 'slack:C1:100', id: '100', text: 'export is broken', user: 'U_ADA' })
    await vi.waitFor(async () => expect(await read(julian, 'firehose')).toHaveLength(1))
    await webhook({ type: 'edit', threadId: 'slack:C1:100', id: '100', text: 'export is broken on Safari', user: 'U_ADA' })
    await webhook({ type: 'reaction', threadId: 'slack:C1:100', messageId: '100', emoji: 'eyes', added: true, user: 'U_BOB' })
    await vi.waitFor(async () => expect((await read(julian, 'firehose'))[0]).toMatchObject({ text: 'export is broken on Safari', reactions: { eyes: ['slack:user:U_BOB'] } }))

    // From the board: a reply, then its edit and a reaction on it.
    const [root] = await read(julian, 'firehose')
    const reply = (await julian('POST', '/messages', { re: root!.id, text: 'looking' })).body.message
    await vi.waitFor(() => expect(s.posts).toHaveLength(1))
    await julian('POST', `/messages/${reply.id}/edit`, { text: 'looking into it' })
    await julian('POST', `/messages/${reply.id}/reactions`, { emoji: 'rocket' })
    await vi.waitFor(() => expect(s.edits.map((edit) => [edit.messageId, edit.text])).toEqual([[s.posts[0]!.id, JSON.stringify({ markdown: '**julian**: looking into it' })]]))
    await vi.waitFor(() => expect(s.reactions).toEqual([{ threadId: 'slack:C1:100', messageId: s.posts[0]!.id, emoji: 'rocket', added: true }]))
  })

  it('links a Slack account through a code, on the board it uses', async () => {
    const { team, project, webhook, s } = setup()
    const here = await julianOn(team.fetch)
    // Linking starts where sync runs: the project's board.
    const challenge = (await (await julianOn(project.fetch, SUPPORT_URL))('POST', '/identity/link', { sync: 'slack' })).body
    expect(challenge).toMatchObject({ method: 'code', sync: 'slack', platform: 'slack', code: expect.stringMatching(/^vb-[A-Z2-9]{4}-[A-Z2-9]{4}$/) })
    await webhook({ type: 'message', threadId: 'slack:C1:100', id: '100', text: challenge.code, user: 'U_JULIAN', name: 'jb' })
    await vi.waitFor(async () => expect((await here('GET', '/identity')).body.links).toEqual([expect.objectContaining({ actor: 'slack:user:U_JULIAN', method: 'code' })]))
    // The code was claimed, not imported, and Slack shows it worked.
    expect(await read(here, 'firehose')).toEqual([])
    expect(s.reactions).toEqual([{ threadId: 'slack:C1:100', messageId: '100', emoji: 'check', added: true }])
  })

  it('runs its middleware on what Slack sends, before it reaches the board it uses', async () => {
    const quiet: Middleware = async ({ write, next }) => next({ text: write.text.replace(/\s*hunter2/g, '') })
    const { team, webhook } = setup({ middleware: [quiet] })
    const julian = await julianOn(team.fetch)
    await webhook({ type: 'message', threadId: 'slack:C1:100', id: '100', text: 'the password is hunter2', user: 'U_ADA' })
    await vi.waitFor(async () => expect((await read(julian, 'firehose')).map((m) => m.text)).toEqual(['the password is']))
  })
})

describe('the sync permission', () => {
  const author = { id: 'slack:user:U_ADA', handle: 'ada', name: 'Ada', avatar: null, isBot: false }

  it("gates every sync route: a caller without it can't speak for platform users", async () => {
    const team = testBoard({ access: [vercelProject({ project: 'prj_support', can: { firehose: ['read', 'post'] } })] })
    const support = caller(team.fetch, await supportToken())
    const julian = await julianOn(team.fetch)
    const root = (await julian('POST', '/messages', { channel: 'firehose', text: 'hello' })).body.message
    const event = { kind: 'message', channel: 'slack:C1', thread: 'slack:C1:1', subthread: null, message: '1', isRoot: true, text: 'hi', context: null, author }
    for (const [method, path, body] of [
      ['POST', '/sync/imports', { op: 'post', author, from: 'slack', channel: 'firehose', text: 'as Ada' }],
      ['POST', '/sync/receipts', { kind: 'message', message: root.id, target: 'slack:C1', external: { thread: 'slack:C1:1', message: '1' } }],
      ['GET', `/sync/threads/${root.thread}`],
      ['GET', '/sync/find?thread=slack:C1:1'],
      ['GET', `/sync/copies?message=${root.id}`],
      ['GET', '/sync/roots?by=vercel:user:u_julian&since=0'],
      ['POST', '/inbox/slack', { events: [{ id: '1', event, raw: {} }] }],
      ['GET', '/inbox/slack/next'],
      ['POST', '/inbox/slack/1/ack', { lease: 'l1' }],
      ['GET', '/inbox/slack'],
      ['POST', '/sync/codes', { sync: 'slack', person: 'vercel:user:u_julian' }],
      ['POST', '/sync/accounts', { sync: 'slack', account: author, person: 'vercel:user:u_julian' }],
    ] as const) {
      const denied = await support(method, path, body)
      expect(denied.status, `${method} ${path}`).toBe(403)
    }
    expect(await read(julian, 'firehose')).toHaveLength(1)
    expect((await julian('GET', '/identity')).body.links).toEqual([])
  })

  it("lets a caller with it in another subtree import there, and not here", async () => {
    const team = testBoard({ access: [vercelProject({ project: 'prj_support', can: { 'support/': 'all', firehose: ['read'] } })] })
    const support = caller(team.fetch, await supportToken())
    const julian = await julianOn(team.fetch)
    const post = (channel: string) => support('POST', '/sync/imports', { op: 'post', author, from: 'slack', channel, text: `from Slack to ${channel}` })
    const denied = await post('firehose')
    expect([denied.status, denied.body.error.message]).toEqual([403, "this token can't sync in firehose, so it can't import there"])
    expect((await post('support/inbox')).status).toBe(200)
    expect((await read(julian, 'support/inbox')).map((m) => [m.text, m.by.actor])).toEqual([['from Slack to support/inbox', 'slack:user:U_ADA']])
    expect(await read(julian, 'firehose')).toEqual([])

    // Nor can it reply into, receipt, or look up a thread here.
    const root = (await julian('POST', '/messages', { channel: 'firehose', text: 'ours' })).body.message
    expect((await support('POST', '/sync/imports', { op: 'post', author, from: 'slack', re: root.id, text: 'as Ada' })).status).toBe(403)
    expect((await support('POST', '/sync/receipts', { kind: 'failed', message: root.id, target: 'slack:C1', error: 'gone' })).status).toBe(403)
    expect((await support('GET', `/sync/threads/${root.thread}`)).status).toBe(404)
    // A person's account is still only linked by someone who may sync somewhere: here, it may.
    expect((await support('POST', '/sync/accounts', { sync: 'slack', account: author, person: 'vercel:user:u_ada' })).status).toBe(200)
  })

  it('takes provenance only on the sync routes: a post never says who it is by', async () => {
    const team = testBoard({ access: [vercelProject({ project: 'prj_support', can: 'all' })] })
    const support = caller(team.fetch, await supportToken())
    const julian = await julianOn(team.fetch)
    const posted = (await support('POST', '/messages', { channel: 'firehose', text: 'hi', author, origin: { thread: 'slack:C1:1', message: '1' }, from: 'slack' })).body.message
    expect(posted).toMatchObject({ by: { actor: SUPPORT }, from: null, origin: null })
    expect((await read(julian, 'firehose'))[0]).toMatchObject({ by: { actor: SUPPORT }, from: null })
  })
})
