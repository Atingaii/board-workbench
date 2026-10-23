// An in-memory `/v1/messageboard`, as its README (vercel/api#101009) says it behaves: what
// `vercel()` from `@vercel/board/backend-vercel` is tested against. A bearer token names its principal:
// `user:u_jb`, `app:oac_1`, or `project:prj_pong:production`.
import { randomUUID } from 'node:crypto'

type Principal =
  | { type: 'user'; userId: string }
  | { type: 'app'; clientId: string }
  | { type: 'project'; projectId: string; environment: string }
type Actor = { id: string; principal: Principal; profile?: { name: string; avatar?: string }; session?: string }
type Message = {
  id: string
  threadId: string
  sequence: number
  replyTo?: number
  text: string
  revision: number
  createdAt: number
  createdBy: Actor
  editedAt?: number
  deletedAt?: number
  changes: number
  reactions: Map<string, Map<string, { actor: Actor; createdAt: number }>>
  labels: Record<string, string>
}
type Thread = {
  id: string
  channelId: string
  messageCount: number
  lastActivityAt: number
  lastMessage?: { id: string; sequence: number; createdAt: number; createdBy: Actor }
  createdAt: number
  createdBy: Actor
  messages: Message[]
}
type Change = Record<string, unknown> & { createdAt: number }

const EMOJI = /^[a-z0-9_+-]{1,64}$/
const CHANNEL = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/
const MESSAGE_ID = /^msg_([0-9a-f-]{36})_(\d+)$/

class Refused extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message = code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function fakeMessageboard(options: { teamId?: string; boardId?: string | null } = {}) {
  const teamId = options.teamId ?? 'team_test'
  const boardId = options.boardId === undefined ? 'brd_test' : options.boardId
  const channels: { id: string; name: string }[] = [{ id: 'general', name: 'general' }]
  const threads = new Map<string, Thread>()
  const posts = new Map<string, string>()
  const feeds = new Map<string, Change[]>()
  const requests: string[] = []
  let clock = 0
  const now = () => (clock = Math.max(Date.now(), clock + 1))

  const principalId = (p: Principal) => (p.type === 'user' ? `vercel:user:${p.userId}` : p.type === 'app' ? `vercel:app:${p.clientId}` : `vercel:project:${p.projectId}:${p.environment}`)
  const samePrincipal = (a: Principal, b: Principal) => principalId(a) === principalId(b)

  function actorOf(request: Request): Actor {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
    const [type, id, environment] = token.split(':')
    const principal: Principal | null =
      type === 'user' && id ? { type, userId: id } : type === 'app' && id ? { type, clientId: id } : type === 'project' && id && environment ? { type, projectId: id, environment } : null
    if (!principal) throw new Refused(401, 'unauthorized')
    const name = request.headers.get('x-board-profile') ?? undefined
    const avatar = request.headers.get('x-board-avatar') ?? undefined
    const session = request.headers.get('x-board-session') ?? undefined
    const base = principalId(principal)
    return {
      id: name ? `${base}+${name.toLowerCase()}` : base,
      principal,
      ...(name ? { profile: { name, ...(avatar ? { avatar } : {}) } } : {}),
      ...(session ? { session } : {}),
    }
  }

  const show = (m: Message) => ({
    id: m.id,
    threadId: m.threadId,
    sequence: m.sequence,
    ...(m.replyTo !== undefined ? { replyTo: m.replyTo } : {}),
    text: m.text,
    revision: m.revision,
    version: 1 + m.changes,
    createdAt: m.createdAt,
    createdBy: m.createdBy,
    ...(m.editedAt !== undefined ? { editedAt: m.editedAt } : {}),
    ...(m.deletedAt !== undefined ? { deletedAt: m.deletedAt } : {}),
    ...(m.reactions.size ? { reactions: Object.fromEntries([...m.reactions].map(([emoji, by]) => [emoji, by.size])) } : {}),
    ...(Object.keys(m.labels).length ? { labels: { ...m.labels } } : {}),
  })
  const showThread = (t: Thread) => {
    const { messages, ...rest } = t
    const labels = messages[0]?.labels ?? {}
    return { ...rest, teamId, boardId, ...(Object.keys(labels).length ? { labels: { ...labels } } : {}) }
  }
  const meta = (m: Message) => {
    const { id, threadId, sequence, version, reactions, labels } = show(m)
    return { id, threadId, sequence, version, ...(reactions ? { reactions } : {}), ...(labels ? { labels } : {}) }
  }

  function emit(channelId: string, change: Record<string, unknown>, actor: Actor) {
    const feed = feeds.get(channelId) ?? []
    feeds.set(channelId, feed)
    feed.push({ id: `evt_${randomUUID()}`, channelId, actor, createdAt: now(), shard: 0, sequence: feed.length + 1, ...change })
  }

  const threadAt = (id: string) => {
    const thread = threads.get(id)
    if (!thread) throw new Refused(404, 'thread_not_found')
    return thread
  }
  const messageAt = (threadId: string, sequence: number) => {
    const message = threadAt(threadId).messages[sequence - 1]
    if (!message) throw new Refused(404, 'message_not_found')
    return message
  }
  const channelAt = (id: string) => {
    const channel = channels.find((c) => c.id === id)
    if (!channel) throw new Refused(404, 'channel_not_found')
    return channel
  }

  function post(actor: Actor, thread: Thread, body: { text: string; replyTo?: number; clientId?: string }) {
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 10_000) throw new Refused(400, 'invalid_message')
    if (body.replyTo !== undefined && (body.replyTo < 1 || body.replyTo > thread.messageCount)) throw new Refused(400, 'invalid_reply')
    const sequence = thread.messageCount + 1
    const createdAt = now()
    const message: Message = {
      id: `msg_${thread.id.slice('thr_'.length)}_${sequence}`,
      threadId: thread.id,
      sequence,
      ...(body.replyTo !== undefined ? { replyTo: body.replyTo } : {}),
      text: body.text,
      revision: 1,
      createdAt,
      createdBy: actor,
      changes: 0,
      reactions: new Map(),
      labels: {},
    }
    thread.messages.push(message)
    thread.messageCount = sequence
    thread.lastActivityAt = createdAt
    thread.lastMessage = { id: message.id, sequence, createdAt, createdBy: actor }
    if (body.clientId) posts.set(`${principalId(actor.principal)}|${body.clientId}`, message.id)
    emit(thread.channelId, { type: 'message.posted', threadId: thread.id, message: sequence, messageId: message.id, revision: 1 }, actor)
    return message
  }

  /** A repeat of a post with the same client ID, by the same principal: the first one. */
  function repeat(actor: Actor, clientId: unknown) {
    if (clientId === undefined) return null
    if (typeof clientId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(clientId)) throw new Refused(400, 'invalid_client_id')
    const id = posts.get(`${principalId(actor.principal)}|${clientId}`)
    if (!id) return null
    const [, uuid, sequence] = MESSAGE_ID.exec(id)!
    const thread = threadAt(`thr_${uuid}`)
    return { thread: showThread(thread), message: show(thread.messages[Number(sequence) - 1]!) }
  }

  function page<T>(items: T[], cursor: string | null, size: number) {
    const from = cursor ? Number(cursor) : 0
    const next = from + size < items.length ? String(from + size) : null
    return { items: items.slice(from, from + size), cursor: next }
  }

  async function route(request: Request): Promise<unknown> {
    const url = new URL(request.url)
    if (url.searchParams.get('teamId') && url.searchParams.get('teamId') !== teamId) throw new Refused(403, 'forbidden')
    const actor = actorOf(request)
    const path = url.pathname.replace(/^\/v1\/messageboard/, '')
    const method = request.method
    requests.push(`${method} ${path}`)
    const body = method === 'GET' ? {} : ((await request.json()) as Record<string, any>)
    if (method !== 'GET' && typeof body.operationId !== 'string') throw new Refused(400, 'invalid_operation_id')
    if (method === 'GET' && path === '/me') return { teamId, actor }
    if (method === 'GET' && path === '/boards') return { boards: boardId ? [{ id: boardId, teamId, name: 'General', visibility: 'team' }] : [], defaultBoardId: boardId, cursor: null }
    const onBoard = /^\/boards\/([^/]+)(\/.*)?$/.exec(path)
    if (!onBoard || onBoard[1] !== boardId) throw new Refused(404, 'board_not_found')
    const rest = onBoard[2] ?? ''
    let found: RegExpExecArray | null

    if (method === 'GET' && rest === '/channels') {
      const name = url.searchParams.get('name')
      return { channels: name === null ? channels : channels.filter((c) => c.name === name), cursor: null }
    }
    if (method === 'POST' && rest === '/channels') {
      if (typeof body.name !== 'string' || body.name.length > 80 || !CHANNEL.test(body.name)) throw new Refused(400, 'invalid_channel_name')
      if (channels.some((c) => c.name === body.name)) throw new Refused(409, 'channel_name_taken')
      const channel = { id: `chn_${randomUUID()}`, name: body.name }
      channels.push(channel)
      return { channel }
    }
    if (method === 'GET' && rest === '/threads') {
      const channelId = url.searchParams.get('channelId') ?? ''
      channelAt(channelId)
      const label = url.searchParams.get('label')
      let listed = [...threads.values()].filter((t) => t.channelId === channelId)
      if (label !== null) {
        const [key, value] = label.split('=', 2) as [string, string | undefined]
        listed = listed.filter((t) => Object.hasOwn(t.messages[0]!.labels, key) && (value === undefined || t.messages[0]!.labels[key] === value))
        listed.sort((a, b) => a.createdAt - b.createdAt)
      } else listed.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      const { items, cursor } = page(listed, url.searchParams.get('cursor'), 25)
      return { threads: items.map(showThread), cursor }
    }
    if (method === 'POST' && rest === '/threads') {
      const again = repeat(actor, body.clientId)
      if (again) return again
      const channel = channelAt(body.channelId)
      const createdAt = now()
      const thread: Thread = { id: `thr_${randomUUID()}`, channelId: channel.id, messageCount: 0, lastActivityAt: createdAt, createdAt, createdBy: actor, messages: [] }
      threads.set(thread.id, thread)
      const message = post(actor, thread, body as { text: string; clientId?: string })
      if (body.labels) Object.assign(message.labels, body.labels)
      return { thread: showThread(thread), message: show(message) }
    }
    if ((found = /^\/messages\/([^/]+)$/.exec(rest)) && method === 'GET') {
      const id = /^msg_([0-9a-f-]{36})_([1-9]\d*)$/.exec(decodeURIComponent(found[1]!))
      if (!id) throw new Refused(404, 'message_not_found')
      const thread = threads.get(`thr_${id[1]}`)
      const message = thread?.messages[Number(id[2]) - 1]
      if (!thread || !message) throw new Refused(404, 'message_not_found')
      return { thread: showThread(thread), message: show(message) }
    }
    if ((found = /^\/posts\/([^/]+)$/.exec(rest)) && method === 'GET') {
      const again = repeat(actor, decodeURIComponent(found[1]!))
      if (!again) throw new Refused(404, 'post_not_found')
      return again
    }
    if (method === 'GET' && rest === '/changes') {
      const channelId = url.searchParams.get('channelId') ?? ''
      channelAt(channelId)
      const feed = feeds.get(channelId) ?? []
      if (url.searchParams.get('from') === 'latest') return { events: [], cursor: String(feed.length), caughtUp: true }
      const from = Number(url.searchParams.get('cursor') ?? 0)
      const events = feed.slice(from, from + 50)
      return { events, cursor: String(from + events.length), caughtUp: from + events.length >= feed.length }
    }
    if ((found = /^\/threads\/([^/]+)$/.exec(rest)) && method === 'GET') return { thread: showThread(threadAt(found[1]!)) }
    if ((found = /^\/threads\/([^/]+)\/messages$/.exec(rest))) {
      const thread = threadAt(found[1]!)
      if (method === 'GET') {
        const { items, cursor } = page(thread.messages, url.searchParams.get('cursor'), 50)
        return { messages: items.map(show), cursor }
      }
      const again = repeat(actor, body.clientId)
      if (again) return again
      return { thread: showThread(thread), message: show(post(actor, thread, body as { text: string; replyTo?: number; clientId?: string })) }
    }
    if ((found = /^\/threads\/([^/]+)\/messages\/(\d+)(\/delete|\/reactions|\/labels)?$/.exec(rest))) {
      const thread = threadAt(found[1]!)
      const message = messageAt(thread.id, Number(found[2]))
      const ref = { threadId: thread.id, message: message.sequence, messageId: message.id }
      const action = found[3] ?? ''
      if (method === 'PATCH' && action === '') {
        if (!samePrincipal(message.createdBy.principal, actor.principal)) throw new Refused(403, 'message_not_owned')
        if (message.deletedAt !== undefined) throw new Refused(409, 'message_deleted')
        if (message.text !== body.text) {
          Object.assign(message, { text: body.text, editedAt: now(), revision: message.revision + 1, changes: message.changes + 1 })
          emit(thread.channelId, { type: 'message.edited', ...ref, revision: message.revision }, actor)
        }
        return { message: show(message) }
      }
      if (method === 'POST' && action === '/delete') {
        if (!samePrincipal(message.createdBy.principal, actor.principal)) throw new Refused(403, 'message_not_owned')
        if (message.deletedAt === undefined) {
          Object.assign(message, { text: '', deletedAt: now(), revision: message.revision + 1, changes: message.changes + 1 })
          emit(thread.channelId, { type: 'message.deleted', ...ref, revision: message.revision }, actor)
        }
        return { message: show(message) }
      }
      if (method === 'GET' && action === '/reactions') {
        const reactions = [...message.reactions].flatMap(([emoji, by]) => [...by.values()].map(({ actor, createdAt }) => ({ emoji, actor, createdAt })))
        return { reactions, cursor: null }
      }
      if (method === 'POST' && action === '/reactions') {
        if (typeof body.emoji !== 'string' || !EMOJI.test(body.emoji) || Object.hasOwn(Object.prototype, body.emoji)) throw new Refused(400, 'invalid_emoji')
        if (message.deletedAt !== undefined) throw new Refused(409, 'message_deleted')
        const by = message.reactions.get(body.emoji) ?? new Map()
        if (body.remove ? by.has(actor.id) : !by.has(actor.id)) {
          if (body.remove) by.delete(actor.id)
          else by.set(actor.id, { actor, createdAt: now() })
          if (by.size) message.reactions.set(body.emoji, by)
          else message.reactions.delete(body.emoji)
          message.changes++
          emit(thread.channelId, { type: body.remove ? 'message.reaction_removed' : 'message.reaction_added', ...ref, emoji: body.emoji }, actor)
        }
        return { meta: meta(message) }
      }
      if (method === 'POST' && action === '/labels') {
        const set = (body.set ?? {}) as Record<string, string>
        const unset = (body.unset ?? []) as string[]
        if (unset.some((key) => Object.hasOwn(set, key))) throw new Refused(400, 'invalid_label')
        const changes: Record<string, { from?: string; to?: string }> = {}
        for (const key of unset)
          if (Object.hasOwn(message.labels, key)) {
            changes[key] = { from: message.labels[key]! }
            delete message.labels[key]
          }
        for (const [key, value] of Object.entries(set))
          if (message.labels[key] !== value) {
            changes[key] = { ...(Object.hasOwn(message.labels, key) ? { from: message.labels[key]! } : {}), to: value }
            message.labels[key] = value
          }
        if (Object.keys(message.labels).length > 16) throw new Refused(400, 'too_many_labels')
        if (Object.keys(changes).length) {
          message.changes++
          emit(thread.channelId, { type: 'message.labeled', ...ref, labels: changes }, actor)
        }
        return { meta: meta(message) }
      }
    }
    throw new Refused(404, 'not_found', `${method} ${path}`)
  }

  return {
    /** Every request it answered, as `METHOD /path`. */
    requests,
    /** The API, as `fetch` reaches it. */
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      try {
        return Response.json(await route(request))
      } catch (error) {
        if (error instanceof Refused) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status })
        throw error
      }
    }) as typeof fetch,
  }
}

/** A fetch to `api` as `principal` (`user:u_jb`, `project:prj_pong:production`): the bearer token the fake reads. */
export const as = (api: ReturnType<typeof fakeMessageboard>, principal: string): typeof fetch =>
  (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${principal}`)
    return api.fetch(input, { ...init, headers })
  }) as typeof fetch
