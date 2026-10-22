import { Redis } from 'ioredis'
import { afterAll, describe, expect, it, vi } from 'vitest'
// The engine itself, as a2() starts it.
import { mount as board } from './harness.ts'
import { redis } from '../src/store/redis.ts'
import { redisHttp } from '../src/store/redis-http.ts'
import { tablesKeyBase } from '../src/store/redis-tables.ts'
import { upstashRest } from './upstash.ts'
import type { BoardStore } from '../src/store/types.ts'
import { BOARD_URL, caller, PROJECT_ID, personToken, TEAM_ID, testAuth } from './harness.ts'

// The production shape: A2's Redis store and vboard's tables on one real Redis, under one prefix.
// Runs when TEST_REDIS_URL points at a server (CI has one).
const url = process.env.TEST_REDIS_URL

describe.skipIf(!url)('vboard on Redis', () => {
  const prefix = `vboard_test_${process.pid}_${Date.now()}`
  const stores: BoardStore[] = []

  afterAll(async () => {
    for (const store of stores) await store.close()
    const client = new Redis(url!)
    const keys = await client.keys(`${prefix}*`)
    if (keys.length > 0) await client.del(...keys)
    client.disconnect()
  })

  it('posts, replies, labels, and reads back from its tables', async () => {
    const store = redis({ url: url!, keyPrefix: `${prefix}a` })
    stores.push(store)
    const mounted = board({ store, url: BOARD_URL, project: { id: PROJECT_ID, teamId: TEAM_ID }, auth: testAuth })
    const julian = caller(mounted.fetch, await personToken())
    const root = await julian('POST', '/messages', { channel: 'dev', text: 'Deploy is red', labels: { kind: 'bug' } })
    expect(root.status).toBe(201)
    const id = root.body.message.id as string
    await julian('POST', '/messages', { re: id, text: 'looking' })
    await julian('POST', '/messages', { re: id, text: 'fixed' })
    await julian('POST', `/messages/${id}/labels`, { set: { status: 'done' } })

    // A write's own read sees it at once: the tables are caught up before it answers.
    const thread = await julian('GET', `/messages/${id}`)
    expect(thread.body.message.labels).toEqual({ kind: 'bug', status: 'done' })
    expect(thread.body.replies.map((reply: { text: string }) => reply.text)).toEqual(['looking', 'fixed'])

    // A reply matches its root's labels.
    const filtered = await julian('GET', '/messages?label=status=done&text=fix')
    expect(filtered.body.messages.map((m: { text: string }) => m.text)).toEqual(['fixed'])
    const threads = await julian('GET', '/threads?channel=dev')
    expect(threads.body.threads).toEqual([expect.objectContaining({ replies: 2, last: expect.objectContaining({ text: 'fixed' }) })])
    expect(Number(threads.body.cursor)).toBeGreaterThanOrEqual(Number(id))
  })

  it('shares a client it was given between A2 and the tables', async () => {
    const client = new Redis(url!)
    const shared = redis({ client, keyPrefix: `${prefix}b` })
    const mounted = board({ store: shared, url: BOARD_URL, project: { id: PROJECT_ID, teamId: TEAM_ID }, auth: testAuth })
    const julian = caller(mounted.fetch, await personToken())
    const root = await julian('POST', '/messages', { channel: 'pool', text: 'one client' })
    await julian('POST', '/messages', { re: root.body.message.id, text: 'for both' })
    const thread = await julian('GET', `/messages/${root.body.message.id}`)
    expect(thread.body.replies.map((reply: { text: string }) => reply.text)).toEqual(['for both'])
    expect(await client.exists(`${tablesKeyBase(`${prefix}b`)}:m`)).toBe(1)
    await shared.close()
    await vi.waitFor(() => expect(client.status).toBe('end'))
  })

  it("runs on Upstash's REST API, every script held to its key-locking rules", async () => {
    const rest = await upstashRest(url!)
    const store = redisHttp({ url: rest.url, token: 'test', keyPrefix: `${prefix}c` })
    try {
      const mounted = board({ store, url: BOARD_URL, project: { id: PROJECT_ID, teamId: TEAM_ID }, auth: testAuth })
      const julian = caller(mounted.fetch, await personToken())
      const root = await julian('POST', '/messages', { channel: 'dev', text: 'Upstash locks keys', labels: { kind: 'bug' } })
      expect(root.status).toBe(201)
      await julian('POST', '/messages', { re: root.body.message.id, text: 'only its own' })
      const thread = await julian('GET', `/messages/${root.body.message.id}`)
      expect(thread.body.replies.map((reply: { text: string }) => reply.text)).toEqual(['only its own'])
      expect((await julian('GET', '/messages?label=kind=bug')).body.messages).toHaveLength(2)
      // A2's scripts and the tables' both carried the flag: the shim ran each under Upstash's rules.
      const scripts = rest.commands.filter(([command]) => command === 'EVAL').map(([, script]) => script!)
      expect(scripts.length).toBeGreaterThan(0)
      expect(scripts.filter((script) => !script.startsWith('#!lua flags='))).toEqual([])
      expect(rest.commands.filter(([command]) => command === 'PUBLISH').length).toBeGreaterThan(0)
    } finally {
      await store.close()
      await rest.close()
    }
  })

  it('refuses a prefix vboard wrote on A2 0.21, saying to give the store a new one', async () => {
    const client = new Redis(url!)
    // What A2 0.21 marked its prefix with, and the tables it kept beside it.
    await client.set(`${prefix}d:schema`, 'cursors-2')
    await client.set(`${prefix}d:vboard:pos`, '12')
    client.disconnect()
    const store = redis({ url: url!, keyPrefix: `${prefix}d` })
    stores.push(store)
    const mounted = board({ store, url: BOARD_URL, project: { id: PROJECT_ID, teamId: TEAM_ID }, auth: testAuth })
    const julian = caller(mounted.fetch, await personToken())
    const posted = await julian('POST', '/messages', { channel: 'dev', text: 'on the old prefix' })
    expect(posted.status).toBe(503)
    expect(posted.body.error.message).toContain(`the redis keys under prefix '${prefix}d' hold an A2 layout other than 'tagged-1'`)
    expect(posted.body.error.message).toContain('point the store at a fresh keyPrefix')
  })

  it("can't take a keyPrefix with braces", () => {
    expect(() => redis({ url: url!, keyPrefix: 'board{1}' })).toThrow(TypeError)
    expect(() => redisHttp({ url: 'http://127.0.0.1:1', token: 'test', keyPrefix: 'board{1}' })).toThrow(TypeError)
  })
})
