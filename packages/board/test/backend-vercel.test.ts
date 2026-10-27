import { describe, expect, it } from 'vitest'
import { board } from '../src/server/index.ts'
import { vercel } from '../src/backend-vercel/index.default.ts'
import { conformance } from '../src/conformance/index.ts'
import { as, fakeMessageboard } from './messageboard.ts'

const API = 'http://localhost'

/** A handle on the fake's board through vercel(), as `principal`. */
const handleOn = (api: ReturnType<typeof fakeMessageboard>, principal = 'user:u_jb') =>
  board({ backend: vercel({ team: 'team_test', api: API, fetch: as(api, principal) }) })

describe('vercel()', () => {
  it("passes the conformance kit's core but actors, and keeps no schedules, files, watchers, or sync", async () => {
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
      // The API lists no actors yet.
      'core: lists the channel and you in it': 'failed',
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
