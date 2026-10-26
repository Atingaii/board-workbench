import { describe, expect, it } from 'vitest'
import { board } from '../src/server/index.ts'
import { vercel } from '../src/backend-vercel/index.default.ts'
import { conformance } from '../src/conformance/index.ts'
import { compileAccess, type Can } from '../src/server/access.ts'
import type { Caller } from '../src/server/backend.ts'
import { as, fakeMessageboard } from './messageboard.ts'

const API = 'http://localhost'

/** A handle on the fake's board through vercel(), as `principal`. */
const handleOn = (api: ReturnType<typeof fakeMessageboard>, principal = 'user:u_jb') =>
  board({ backend: vercel({ team: 'team_test', api: API, fetch: as(api, principal) }) })

/** A caller board() verified, with `can`: what a board with an `access` passes its backend. */
const verified = (can: Can) =>
  ({
    identity: {
      principal: { id: 'vercel:user:u_ada', access: compileAccess(can), expiresAt: null },
      author: { actor: 'vercel:user:u_ada', principal: 'vercel:user:u_ada', profile: null, session: null },
      actor: { id: 'vercel:user:u_ada', kind: 'person', handle: 'ada', name: 'Ada', avatar: null },
    },
    origin: { via: null },
  }) as unknown as Caller

describe('vercel()', () => {
  it("passes the conformance kit's core, and keeps no schedules, files, watchers, or sync", async () => {
    const report = await conformance(handleOn(fakeMessageboard()))
    const statuses = Object.fromEntries(report.checks.map((check) => [`${check.group}: ${check.name}`, check.status]))
    expect(statuses).toEqual({
      'core: says in its discovery where it is': 'passed',
      'core: posts a message, and reads it back by its ID': 'passed',
      "core: puts a reply in its root's thread": 'passed',
      'core: posts once for a client ID, however many times it is sent': 'passed',
      'core: raises the version with each edit, reaction, and label': 'passed',
      "core: matches a label on the message or its thread's root": 'passed',
      'core: reads a channel after a cursor or a message ID, oldest first': 'passed',
      'core: lists threads, each with its reply count and latest reply': 'passed',
      'core: reads events after a cursor, each with a cursor of its own': 'passed',
      'core: holds a long-poll open until the next event': 'passed',
      'core: deletes a message, leaving a tombstone': 'passed',
      'core: lists the channel and you in it': 'passed',
      'core: answers 404 for an ID that names nothing': 'passed',
      'core: answers 400 for a request that does not validate': 'passed',
      'schedules: schedules a reply, lists it, and cancels it': 'skipped',
      'attachments: takes a file, posts it, and gives it back': 'skipped',
      'watchers: matches a registered tail, hands the match to a pull, and takes its ack': 'failed',
      'watchers: wakes by path only where its discovery says so, and only a Vercel project': 'failed',
      "sync: keeps sync's records: an import as a platform author, its lookups by platform ID, a receipt, and where it's synced": 'failed',
    })
  }, 30_000)

  it('writes as the project a deployment is, per environment, and as an agent with its profile', async () => {
    const api = fakeMessageboard()
    const pong = handleOn(api, 'project:prj_pong:production')
    const { id } = await pong.post('pings', { text: 'ping' })
    const reply = await pong.as('claude').reply(id, { text: 'pong', labels: { kind: 'task' } })
    const { message, replies } = await pong.thread(id)
    expect(message).toMatchObject({ channel: 'pings', by: { principal: 'vercel:project:prj_pong:production', profile: null }, author: { kind: 'deployment', handle: 'prj_pong' } })
    expect(replies).toMatchObject([{ id: reply.id, re: id, labels: { kind: 'task' }, by: { actor: 'vercel:project:prj_pong:production+claude', profile: 'claude' }, author: { kind: 'agent', handle: 'claude' } }])
    // `me` is who the handle writes as, its profile included.
    expect((await pong.as('claude').messages({ channel: 'pings', by: 'me' })).messages.map((m) => m.id)).toEqual([reply.id])
    expect((await pong.messages({ channel: 'pings', by: 'me' })).messages.map((m) => m.id)).toEqual([id])
    // A preview is someone else.
    const preview = handleOn(api, 'project:prj_pong:preview')
    expect((await preview.me()).principal).toBe('vercel:project:prj_pong:preview')
  })

  it('reads a channel and the channels under it, and finds threads by a label', async () => {
    const api = fakeMessageboard()
    const team = handleOn(api)
    await team.post('dev', { text: 'one' })
    const two = await team.post('dev/web', { text: 'two', labels: { state: 'open' } })
    await team.post('ops', { text: 'three' })
    expect((await team.messages({ channel: 'dev/' })).messages.map((m) => m.text)).toEqual(['one', 'two'])
    expect((await team.threads({ channel: 'dev/', label: { state: 'open' } })).threads.map((t) => t.message.id)).toEqual([two.id])
  })

  it("lists a busy channel's threads from the API's thread list, reading only the roots and latest replies it shows", async () => {
    const api = fakeMessageboard()
    const team = handleOn(api)
    const roots = []
    for (let i = 0; i < 60; i++) roots.push(await team.post('busy', { text: `thread ${i}` }))
    await team.reply(roots[59]!.id, { text: 'latest' })
    api.requests.length = 0
    const { threads, cursor } = await team.threads({ channel: 'busy', limit: 5 })
    expect(threads.map((t) => t.message.text)).toEqual(['thread 55', 'thread 56', 'thread 57', 'thread 58', 'thread 59'])
    expect(threads.at(-1)).toMatchObject({ replies: 1, last: { text: 'latest' } })
    // One page of the thread list, and a root (and the one latest reply) for each thread it shows.
    expect(api.requests.filter((r) => /\/threads$/.test(r))).toHaveLength(1)
    expect(api.requests.filter((r) => /\/threads\/[^/]+\/messages$/.test(r))).toEqual([])
    expect(api.requests.filter((r) => /\/messages\/msg_/.test(r))).toHaveLength(6)
    // Read on from the cursor, it stops at the first thread that hasn't moved since.
    const later = await team.post('busy', { text: 'thread 60' })
    api.requests.length = 0
    expect((await team.threads({ channel: 'busy', after: cursor })).threads.map((t) => t.message.id)).toEqual([later.id])
    expect(api.requests.filter((r) => /\/threads$/.test(r))).toHaveLength(1)
  })

  it("keeps a verified caller to its grants, which the API can't check for it", async () => {
    const api = fakeMessageboard()
    const team = handleOn(api, 'project:prj_pong:production')
    const dev = await team.post('dev', { text: 'dev' })
    const ops = await team.post('ops', { text: 'ops' })
    const backend = vercel({ team: 'team_test', api: API, fetch: as(api, 'project:prj_pong:production') })
    const ada = verified({ 'dev/': ['read', 'post'] })
    const signal = new AbortController().signal
    const read = async (query: object) => (await backend.messages(ada, query as never, signal)).messages.map((m) => m.text)
    expect(await read({})).toEqual(['dev'])
    expect(await read({ channel: 'ops' })).toEqual([])
    expect((await backend.channels(ada, {}, signal)).channels.map((c) => c.path)).toEqual(['dev'])
    await expect(backend.message(ada, { id: ops.id }, signal)).rejects.toMatchObject({ status: 404, code: 'message_not_found' })
    await expect(backend.post(ada, { channel: 'ops', text: 'hi' } as never, signal)).rejects.toMatchObject({ status: 403 })
    await expect(backend.post(ada, { re: ops.id, text: 'hi' } as never, signal)).rejects.toMatchObject({ status: 404 })
    await expect(backend.post(ada, { channel: 'dev', text: 'hi', labels: { state: 'open' } } as never, signal)).rejects.toMatchObject({ status: 403 })
    await expect(backend.react(ada, { id: dev.id, emoji: 'eyes' }, signal)).rejects.toMatchObject({ status: 403 })
    await expect(backend.label(ada, { id: dev.id, set: { state: 'open' } }, signal)).rejects.toMatchObject({ status: 403 })
    await expect(backend.events(ada, { channel: 'ops' } as never, signal)).resolves.toMatchObject({ events: [] })
    await backend.post(ada, { channel: 'dev', text: 'hi' } as never, signal)
    expect(await read({ channel: 'dev' })).toEqual(['dev', 'hi'])
    // Only who it sees where it reads, and itself: never someone who writes only where it doesn't.
    await handleOn(api, 'user:u_ops').post('ops', { text: 'ops only' })
    const ids = async (caller: Caller) => (await backend.actors(caller, {}, signal)).actors.map((a) => a.id).sort()
    expect(await ids(ada)).toEqual(['vercel:project:prj_pong:production', 'vercel:project:prj_pong:production+ada', 'vercel:user:u_ada'])
    expect(await ids(verified('all'))).toContain('vercel:user:u_ops')
  })

  it("reads one channel from the API's message list and feed, with cursors another process resumes", async () => {
    const api = fakeMessageboard()
    const team = handleOn(api)
    const first = await team.post('busy', { text: 'one' })
    await team.reply(first.id, { text: 'two' })
    await team.post('busy', { text: 'three' })
    api.requests.length = 0
    const latest = await team.messages({ channel: 'busy', limit: 2 })
    expect(latest.messages.map((m) => m.text)).toEqual(['two', 'three'])
    expect(latest.cursor).toMatch(/^c1\./)
    // One page of the channel's messages: no thread is read message by message.
    expect(api.requests.filter((r) => r.endsWith('/messages'))).toEqual(['GET /boards/brd_test/messages'])
    // A cursor is the API's, so a handle in another process, which keeps no positions, goes on from it.
    const other = handleOn(api)
    await other.post('busy', { text: 'four' })
    expect((await other.messages({ channel: 'busy', after: latest.cursor })).messages.map((m) => m.text)).toEqual(['four'])
    const events = await other.poll({ channel: 'busy', after: latest.cursor })
    expect(events.events.map((e) => [e.type, e.message?.text])).toEqual([['message.posted', 'four']])
    expect((await other.poll({ channel: 'busy', after: events.cursor })).events).toEqual([])
  })

  it("makes the team's board the first time a person uses it, and tells a project it needs a grant", async () => {
    const pong = handleOn(fakeMessageboard({ boardId: null }), 'project:prj_pong:production')
    await expect(pong.post('dev', { text: 'hello' })).rejects.toMatchObject({ status: 404, code: 'no_board' })
    const api = fakeMessageboard({ boardId: null })
    await handleOn(api).post('dev', { text: 'hello' })
    expect(api.requests.filter((r) => r === 'POST /boards/default')).toHaveLength(1)
    expect((await handleOn(api).messages({ channel: 'dev' })).messages.map((m) => m.text)).toEqual(['hello'])
  })

  it("refuses watchers and sync when it's made, since the API runs neither yet", () => {
    const backend = vercel({ team: 'team_test', api: API, fetch: as(fakeMessageboard(), 'user:u_jb') })
    expect(() => board({ backend, watch: { ping: { tail: 'pings', run: async () => {} } } })).toThrow(/don't wake watchers/)
  })
})
