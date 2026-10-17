import { describe, expect, it } from 'vitest'
import type { BoardEvent } from '../src/contract/contract.ts'
import { foldActors, foldMessages, type ActorsState, type Message, type MessagesState } from '../src/contract/reducers.ts'
import { compileFilter, toMessageFilter, type ParsedFilters } from '../src/server/feed.ts'
import { sqliteDb } from '../src/store/sqlite-db.ts'
import { sqlTables, type Db } from '../src/store/sql.ts'
import type { MessageTables } from '../src/store/types.ts'
import { pgliteDb } from './pglite-db.ts'

/** A small seeded generator, so a failing history can be replayed. */
function random(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!
  return { next, pick, chance: (p: number) => next() < p }
}

const AUTHORS = [
  { actor: 'vercel:user:u_ada', principal: 'vercel:user:u_ada', profile: null, session: null },
  { actor: 'vercel:user:u_ada+claude', principal: 'vercel:user:u_ada', profile: 'claude', session: 's1' },
  { actor: 'vercel:user:u_bo', principal: 'vercel:user:u_bo', profile: null, session: null },
  { actor: 'slack:user:U1', principal: 'slack:user:U1', profile: null, session: null },
] as const
const SEEN = [
  { actor: 'vercel:user:u_ada', kind: 'person', handle: 'ada', name: 'Ada', avatar: null },
  { actor: 'vercel:user:u_ada+claude', kind: 'agent', handle: 'ada/claude', name: 'Claude', avatar: null },
  { actor: 'vercel:user:u_bo', kind: 'person', handle: 'bo', name: 'Bo', avatar: null },
  { actor: 'slack:user:U1', kind: 'person', handle: 'sam', name: 'Sam', avatar: null },
] as const
const CHANNELS = ['dev', 'dev/sub', 'dev_x', 'ops']
const WORDS = ['PR', '#1', 'fix', 'Bug', 'deploy', 'ÉCLAIR', 'naïve', '100%', 'a_b', 'shipit']
const LABELS = [{ kind: 'bug' }, { kind: 'feature' }, { pr: '1' }, { pr: '2' }, { 'tag.x': 'y' }]

/** A random board history: every event type the messages fold handles, and some it ignores. */
function history(seed: number, length: number): BoardEvent[] {
  const r = random(seed)
  const events: BoardEvent[] = []
  const posted: { id: number; re: number | null; channel: string; thread: string }[] = []
  let at = Date.parse('2026-10-01T00:00:00Z')
  const push = (type: string, payload: unknown, id = `e${events.length + 1}`) => {
    at += 1000
    events.push({ index: events.length + 1, id, type, payload, createdAt: new Date(at).toISOString() } as unknown as BoardEvent)
  }
  for (const seen of SEEN) push('actor.seen', seen)
  const text = () => Array.from({ length: 1 + Math.floor(r.next() * 4) }, () => r.pick(WORDS)).join(' ')
  const labels = () => (r.chance(0.5) ? { ...r.pick(LABELS), ...(r.chance(0.3) ? r.pick(LABELS) : {}) } : {})
  const mentions = () => (r.chance(0.3) ? [r.pick(AUTHORS).actor] : [])
  while (events.length < length) {
    const author = r.pick(AUTHORS)
    const target = posted.length ? r.pick(posted) : null
    const roll = r.next()
    if (!target || roll < 0.25) {
      const id = `e${events.length + 1}`
      const channel = r.pick(CHANNELS)
      push('message.posted', {
        channel, text: text(), re: null, replyTo: null, thread: id, labels: labels(), noSync: r.chance(0.1),
        mentions: mentions(), by: author, origin: null, from: r.chance(0.3) ? 'slack' : null,
      }, id)
      posted.push({ id: events.length, re: null, channel, thread: id })
    } else if (roll < 0.5) {
      const root = target.re ?? target.id
      const rootPost = posted.find((p) => p.id === root)!
      push('message.posted', {
        channel: rootPost.channel, text: text(), re: root, replyTo: target.re === null ? null : target.id, thread: rootPost.thread,
        labels: r.chance(0.2) ? labels() : {}, noSync: false, mentions: mentions(), by: author, origin: null, from: null,
      })
      posted.push({ id: events.length, re: root, channel: rootPost.channel, thread: rootPost.thread })
    } else {
      const base = { id: target.id, thread: target.thread, by: author, from: null }
      const kind = r.pick(['edit', 'delete', 'react', 'unreact', 'labels', 'linked', 'synced', 'failed', 'other'] as const)
      if (kind === 'edit') push('message.edited', { ...base, text: text(), mentions: mentions() })
      else if (kind === 'delete') push('message.deleted', base)
      else if (kind === 'react') push('reaction.added', { ...base, emoji: r.pick(['eyes', '+1', 'thumbs_up']) })
      else if (kind === 'unreact') push('reaction.removed', { ...base, emoji: r.pick(['eyes', 'thumbs_up']) })
      else if (kind === 'labels') push('labels.changed', { id: target.id, thread: target.thread, by: author, set: labels(), unset: r.chance(0.5) ? [r.pick(['kind', 'pr', 'tag.x'])] : [] })
      else if (kind === 'linked') push('message.linked', { ...base, links: [{ url: 'https://example.com', message: null, snapshot: null, unavailable: null }] })
      else if (kind === 'failed') push('message.sync_failed', { id: target.id, thread: target.thread, target: 'slack:C1', error: 'not_in_channel' })
      else if (kind === 'synced') push('message.synced', { id: target.id, thread: target.thread, target: 'slack:C1', external: { thread: 'slack:C1:1', message: '1.2' } })
      else push('thread.synced', { thread: target.thread, target: 'slack:C1', cause: 'request', by: author })
    }
  }
  return events
}

/** The board as the old full-state fold saw it, through `index`. */
function fold(events: readonly BoardEvent[], index = Infinity) {
  const messages: MessagesState = { byId: {}, replies: {} }
  const actors: ActorsState = { byId: {}, byHandle: {}, links: {} }
  for (const event of events) {
    if (event.index > index) break
    foldMessages(messages, event)
    foldActors(actors, event)
  }
  return { messages, actors }
}

/** `/messages` and `/threads` as they were computed over the full state. */
function expectedMessages(state: MessagesState, matches: (m: Message | undefined) => boolean, page: { before?: number; after?: number; limit: number }) {
  let found = Object.values(state.byId).filter(matches).sort((a, b) => a.id - b.id)
  if (page.before !== undefined) found = found.filter((m) => m.id < page.before!)
  return page.after !== undefined ? found.filter((m) => m.id > page.after!).slice(0, page.limit) : found.slice(-page.limit)
}
function expectedThreads(state: MessagesState, matches: (m: Message | undefined) => boolean, page: { after?: number; limit: number }) {
  const roots = new Set<number>()
  for (const message of Object.values(state.byId)) if (matches(message)) roots.add(message.re ?? message.id)
  let found = [...roots].map((id) => {
    const replies = (state.replies[id] ?? []).map((reply) => state.byId[reply]!).filter((reply) => !reply.deleted)
    const last = replies.at(-1) ?? null
    return { root: state.byId[id]!, replies: replies.length, last, at: last?.id ?? id }
  })
  found.sort((a, b) => a.at - b.at)
  found = page.after !== undefined ? found.filter((t) => t.at > page.after!).slice(0, page.limit) : found.slice(-page.limit)
  return found.map(({ root, replies, last }) => ({ root, replies, last }))
}

const FILTERS: ParsedFilters[] = [
  {},
  { channel: 'dev' },
  { channel: 'dev/' },
  { channel: 'dev_x' },
  { by: 'ada' },
  { by: 'ada/claude' },
  { by: 'sam' },
  { mentions: 'bo' },
  { mentions: 'me' },
  { from: 'board' },
  { from: 'slack' },
  { text: 'pr #1' },
  { text: 'éclair' },
  { text: '100%' },
  { text: 'a_b' },
  { label: [['kind', null]] },
  { label: [['kind', ['bug']]] },
  { label: [['kind', ['bug', 'feature']], ['pr', null]] },
  { label: [['tag.x', ['y']]], channel: 'dev/' },
  { by: 'ada', label: [['pr', ['1']]], text: 'fix' },
]

const DIALECTS: [string, () => Promise<Db>][] = [
  ['sqlite', async () => sqliteDb(':memory:')],
  ['postgres (PGlite)', pgliteDb],
]

describe.each(DIALECTS)('tables on %s', (_, open) => {
  async function applied(events: readonly BoardEvent[]): Promise<MessageTables> {
    const tables = sqlTables(await open())
    for (const event of events) await tables.apply(event)
    return tables
  }

  it.each([1, 2, 3])('agree with the full-state fold on every message, thread, and version (history %i)', async (seed) => {
    const events = history(seed, 400)
    const tables = await applied(events)
    const { messages } = fold(events)
    expect(await tables.position()).toBe(events.length)
    for (const message of Object.values(messages.byId)) expect(await tables.message(message.id)).toEqual(message)
    for (const root of Object.values(messages.byId).filter((m) => m.re === null)) {
      const expected = [root, ...(messages.replies[root.id] ?? []).map((id) => messages.byId[id]!)]
      expect(await tables.thread(root.id)).toEqual(expected)
      expect(await tables.byEventId(root.thread)).toEqual(root)
    }
    for (const index of [10, 57, 200, 333]) {
      const then = fold(events, index).messages
      const ids = Object.keys(messages.byId).map(Number)
      const at = await tables.messagesAt(ids, index)
      expect(Object.fromEntries(at)).toEqual(then.byId)
    }
    await tables.close()
  })

  it.each([4, 5])('answer /messages and /threads like the in-memory filter, for every filter and page (history %i)', async (seed) => {
    const events = history(seed, 400)
    const tables = await applied(events)
    const { messages, actors } = fold(events)
    const me = 'vercel:user:u_bo'
    for (const filters of FILTERS) {
      const matches = compileFilter(filters, { me, actors, messages })
      const filter = toMessageFilter(filters, { me, actors })
      for (const page of [{ limit: 50 }, { limit: 7, after: 120 }, { limit: 7, before: 300 }, { limit: 500 }]) {
        const got = await tables.messages(filter, page)
        expect(got.messages, JSON.stringify({ filters, page })).toEqual(expectedMessages(messages, matches, page))
        expect(got.position).toBe(events.length)
        const threadPage = { limit: page.limit, ...(page.after !== undefined ? { after: page.after } : {}) }
        const threads = await tables.threads(filter, threadPage)
        expect(threads.threads, JSON.stringify({ filters, page: threadPage })).toEqual(expectedThreads(messages, matches, threadPage))
      }
    }
    await tables.close()
  })

  it('let a writer apply only the very next event, never ahead of a gap', async () => {
    const events = history(7, 200)
    const tables = sqlTables(await open())
    // A fresh board has no position yet: the consumer starts it, from the first event.
    expect(await tables.applyNext(events[0]!)).toBe(false)
    for (const event of events.slice(0, 50)) await tables.apply(event)
    expect(await tables.applyNext(events[52]!)).toBe(false) // #51 isn't applied yet
    expect(await tables.position()).toBe(50)
    expect(await tables.applyNext(events[50]!)).toBe(true)
    expect(await tables.applyNext(events[50]!)).toBe(false) // already applied
    // Writers and the consumer take turns, in any mix; the tables end up the same.
    for (const event of events.slice(51)) {
      if (event.index % 3 === 0) expect(await tables.applyNext(event)).toBe(true)
      else await tables.apply(event)
      await tables.apply(event) // the consumer, after the writer: a no-op
    }
    const { messages } = fold(events)
    for (const message of Object.values(messages.byId)) expect(await tables.message(message.id)).toEqual(message)
    await tables.close()
  })

  it('apply each event once, however many times it is handed over', async () => {
    const events = history(6, 120)
    const tables = sqlTables(await open())
    for (const event of events) {
      await tables.apply(event)
      await tables.apply(event)
    }
    // A stale attempt, handed an earlier event after later ones landed, changes nothing.
    await tables.apply(events[50]!)
    const { messages } = fold(events)
    for (const message of Object.values(messages.byId)) expect(await tables.message(message.id)).toEqual(message)
    await tables.close()
  })
})
