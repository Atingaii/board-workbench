import {
  AckBody,
  EditBody,
  EventsQuery,
  IdentityUnlinkBody,
  InboxAckBody,
  InboxNextQuery,
  InboxPushBody,
  InboxQuery,
  LabelBody,
  MatchesQuery,
  MessagesQuery,
  PostBody,
  ReactBody,
  Ref,
  RegisterBody,
  ScheduleBody,
  SchedulesQuery,
  SignInQuery,
  SourceReadQuery,
  SyncAccountBody,
  SyncBody,
  SyncCodeBody,
  SyncCopiesQuery,
  SyncFindQuery,
  SyncImportBody,
  SyncReceiptBody,
  SyncRootsQuery,
  SyncUnlinkBody,
  ThreadsQuery,
  TypingBody,
  type MessageView,
} from '../api/routes.ts'
import type { Method, Protocol } from '../api/protocol.ts'
import type { ExternalAuthor } from '../contract/contract.ts'
import { ATTACHMENT_BYTES_MAX } from '../contract/schemas.ts'
import type { SyncEvent } from '../sync/engine.ts'
import { SYNC, type Caller, type InboxDelivery } from './backend.ts'
import type { BoardContext } from './board.ts'
import { derivedId } from '../client/ids.ts'
import { claimsOf, KNOWN_AGENTS } from './actors.ts'
import { avatarSvg } from './avatars.ts'
import { badRequest, forbidden, HttpError, json, notFound, toErrorResponse } from './errors.ts'
import { DroppedError, type WriteSource } from './middleware.ts'
import { createRouter, openapi, queryObject, readCapped, readJson, type BoardRoute } from './routing.ts'
import { compileAccess, type Access } from './access.ts'
import { mentionsEmails, syncTarget, withEmailMentions, type SyncTarget } from './targets.ts'
import type { WriteOrigin } from './writes.ts'
import type { WatcherContext } from './watch.ts'

/** The methods whose answer is something new. */
const CREATED = new Set<Method>(['post', 'schedule', 'upload'])

/** Shown inline only when a browser can't run it: everything else downloads. */
const INLINE = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm)|text\/plain)$/

/**
 * The file, sandboxed: it can't run as a page on the board's origin, and only
 * types a browser can't execute display inline.
 */
function attachmentResponse({ attachment, data }: Protocol['attachment']['output']): Response {
  const disposition = INLINE.test(attachment.type) ? 'inline' : 'attachment'
  const body = data instanceof Uint8Array ? new Blob([data as Uint8Array<ArrayBuffer>]) : data
  return new Response(body, {
    headers: {
      'content-type': attachment.type,
      'content-length': String(attachment.size),
      'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      'content-security-policy': "sandbox; default-src 'none'",
      'x-content-type-options': 'nosniff',
      // An ID's bytes never change.
      'cache-control': 'private, max-age=31536000, immutable',
    },
  })
}

/** A method's input, from the request: its path's `:id` or `:key`, its query, or its body, validated. */
async function inputOf(name: Method, request: Request, url: URL, params: Record<string, string>): Promise<unknown> {
  const id = params.id ?? ''
  const key = params.key ?? ''
  const body = () => readJson(request)
  switch (name) {
    case 'discovery':
    case 'me':
    case 'channels':
    case 'actors':
    case 'identity':
    case 'watchers':
      return {}
    case 'message':
    case 'posted':
    case 'delete':
    case 'cancelSchedule':
    case 'attachment':
      return { id }
    case 'messages':
      return MessagesQuery.parse(queryObject(url))
    case 'threads':
      return ThreadsQuery.parse(queryObject(url))
    case 'schedules':
      return SchedulesQuery.parse(queryObject(url))
    case 'matches':
      return MatchesQuery.parse(queryObject(url))
    case 'events': {
      const query = EventsQuery.parse(queryObject(url))
      // SSE's own resume header, when the client reconnects by itself.
      const last = request.headers.get('last-event-id')
      if (query.after === undefined && last && Ref.safeParse(last).success) query.after = last
      return query
    }
    case 'post':
      return PostBody.parse(await body())
    case 'schedule':
      return ScheduleBody.parse(await body())
    case 'register':
      return RegisterBody.parse(await body())
    case 'edit':
      return { id, ...EditBody.parse(await body()) }
    case 'react':
      return { id, ...ReactBody.parse(await body()) }
    case 'label':
      return { id, ...LabelBody.parse(await body()) }
    case 'ack':
      return { id, ...AckBody.parse(await body()) }
    case 'upload': {
      const header = request.headers.get('x-board-filename')
      let name: string | null = null
      try {
        name = header === null ? null : decodeURIComponent(header)
      } catch {
        throw badRequest('`x-board-filename` is not URI-encoded')
      }
      return { data: await readCapped(request, ATTACHMENT_BYTES_MAX), name, type: request.headers.get('content-type') }
    }
    case 'syncImport':
      return SyncImportBody.parse(await body())
    case 'syncReceipt':
      return SyncReceiptBody.parse(await body())
    case 'syncThread':
      return { thread: params.thread ?? '' }
    case 'syncFind':
      return SyncFindQuery.parse(queryObject(url))
    case 'syncCopies':
      return SyncCopiesQuery.parse(queryObject(url))
    case 'syncRoots':
      return SyncRootsQuery.parse(queryObject(url))
    case 'inboxPush':
      return { key, ...InboxPushBody.parse(await body()) }
    case 'inboxNext':
      return { key, ...InboxNextQuery.parse(queryObject(url)) }
    case 'inboxAck':
      return { key, id, ...InboxAckBody.parse(await body()) }
    case 'inbox':
      return { key, ...InboxQuery.parse(queryObject(url)) }
    case 'syncCode':
      return SyncCodeBody.parse(await body())
    case 'syncAccount':
      return SyncAccountBody.parse(await body())
    case 'syncUnlink':
      return SyncUnlinkBody.parse(await body())
    case 'typing':
      return { id, ...(TypingBody.parse(await body()) ?? {}) }
    case 'readSource':
      return { key, ...SourceReadQuery.parse(queryObject(url)) }
  }
}

/**
 * A sync callback's caller: the platform user its event came from, on sync entry `key`, and how to
 * answer them in the event's platform thread. Its client's writes are imports as that user, and the
 * rest it does as sync.
 */
export type PlatformCaller = {
  platform: { author: ExternalAuthor; key: string; respond: (text: string) => Promise<void> }
  origin: WriteOrigin & { via: Extract<WriteSource, { kind: 'sync' }> }
}

/** board()'s server half, for its handle: what serving, watching, and syncing need, loaded on first use. */
export type Serve = {
  /** Serves a request, or one of this deployment's own calls as `injected`. */
  dispatch(request: Request, injected: Caller | PlatformCaller | null): Promise<Response>
  /** An in-process client's call, as `caller`: its posts get IDs derived from `trigger`, counting `writes`. */
  inject(request: Request, caller: Caller | PlatformCaller, trigger: string | null, writes: { made: number }): Promise<Response>
  run(id: string, event: WatcherContext['event'], meta: { trigger: string; attempt: number }): Promise<void>
  receive(key: string, item: InboxDelivery, meta: { id: string; attempt: number; signal: AbortSignal }): Promise<void>
  pull(): Promise<number>
  /** What `readSource` reads with: sync entry `key`'s app, a 404 `not_synced_here` for one this board doesn't run. */
  readSource(key: string, target: string, limit: number): Promise<Protocol['readSource']['output']>
  /** What `typing` shows typing with: the platforms this board syncs. */
  typing(messages: readonly MessageView[], status: string | undefined): Promise<string[]>
}

/**
 * The board, serving the protocol over HTTP on its backend: it routes and validates each request,
 * and calls the backend's method of the same name with what the request said about its caller,
 * which the backend verifies. Sync runs here too, for requests and for its own code.
 */
export async function createServe(context: BoardContext): Promise<Serve> {
  const { options, backend, runtime } = context
  const entries = options.sync ?? {}
  // The sync engine, and the adapters it drives, only for a board that syncs.
  const engine = Object.keys(entries).length > 0 ? (await runtime.sync()).createSyncEngine(entries) : null
  const streamMaxMs = options.streamMaxMs ?? 280_000
  const route = createRouter(backend.routes, options.basePath)
  const { state, ownUrl, clientAs, handleOf } = context
  const watch = options.watch ?? {}

  /** A request's caller, as it said it is: its bearer token, its claims, and the board's URL. The backend verifies it. */
  function callerOf(request: Request, audience: string): Caller {
    const header = request.headers.get('authorization') ?? ''
    const credential = header.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
    return { request: { credential, claims: claimsOf(request.headers), audience, headers: request.headers }, origin: { via: { kind: 'api' } } }
  }

  /**
   * `@[ada@vercel.com]`: an email a synced platform knows becomes that user's mention, and the
   * board learns who they are; the rest stay plain text.
   */
  async function withEmails(text: string): Promise<string> {
    // Each one sync finds, the board must know before a post can mention them; one it can't learn stays an email.
    const find = engine
      ? async (email: string) => {
          const actor = await engine.findByEmail(email)
          if (actor) await backend.syncImport(engine.caller, { op: 'seen', author: { ...actor, isBot: false } }, new AbortController().signal)
          return actor
        }
      : undefined
    return (await withEmailMentions(text, find)).text
  }

  /**
   * A sync target as the board that syncs it resolves it. One for an entry this board doesn't
   * have goes on as it is, for the sync that does, unless this board syncs: then it's a mistake.
   */
  async function resolveTarget(target: string | SyncTarget): Promise<SyncTarget> {
    if (typeof target !== 'string') return target
    const at = target.indexOf(':')
    if (at <= 0) throw badRequest(`sync targets look like <key>:<channel or thread>, got: ${target}`)
    const key = target.slice(0, at)
    if (engine && entries[key]) return engine.normalizeTarget(target)
    if (engine) throw badRequest(`no sync entry named ${key}`)
    return syncTarget(target)
  }

  /**
   * What a request's caller may do, as the backend says once it has verified them: board() asks
   * before it does anything for them past calling the backend (a platform call, an email lookup,
   * sync's own write, reading an upload), so a caller the backend won't let in starts none of it.
   * Null for this deployment's own code, which may do everything.
   */
  const accesses = new WeakMap<Caller, Promise<Access>>()
  function accessOf(caller: Caller, signal: AbortSignal): Promise<Access> | null {
    if (!('request' in caller)) return null
    let found = accesses.get(caller)
    if (!found) accesses.set(caller, (found = backend.me(caller, {}, signal).then(({ can }) => compileAccess(can))))
    return found
  }

  /**
   * Whether board() may work for a write of `caller`'s that lands in `channel`, or in the thread of
   * message `re`, which it must read: `post` there, as the backend says. One it may not goes to the
   * backend as it came, for the backend to say why.
   */
  async function mayPost(caller: Caller, where: { channel?: string | undefined; re?: string | undefined }, signal: AbortSignal): Promise<{ access: Access | null; channel: string } | null> {
    const channel = where.channel ?? (where.re === undefined ? undefined : (await lookup(caller, where.re, signal))?.channel)
    if (channel === undefined) return null
    const access = await accessOf(caller, signal)
    return access === null || access.can('post', channel) ? { access, channel } : null
  }

  /** A message as `caller` may read it, or null. */
  async function lookup(caller: Caller, id: string, signal: AbortSignal): Promise<MessageView | null> {
    try {
      const { message, replies } = await backend.message(caller, { id }, signal)
      return [message, ...replies].find((candidate) => candidate.id === id) ?? null
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null
      throw error
    }
  }

  /**
   * A post, with the emails it mentions resolved and the targets its channel syncs with landing
   * beside it, once the backend says the caller may post there (and sync, for targets it names).
   */
  async function post(caller: Caller, input: Protocol['post']['input'], signal: AbortSignal): Promise<Protocol['post']['output']> {
    // Without sync, nothing here calls a platform: its targets only take their shape.
    if (!engine) return backend.post(caller, input.sync?.length ? { ...input, sync: await Promise.all(input.sync.map(resolveTarget)) } : input, signal)
    const work = (input.sync?.length ?? 0) > 0 || mentionsEmails(input.text) || (input.channel !== undefined && !input.noSync)
    const allowed = work ? await mayPost(caller, input, signal) : null
    if (!allowed) return backend.post(caller, input, signal)
    const { access, channel } = allowed
    // A reply's targets are a mistake the backend names: only a new thread's go to the platform.
    const syncs = input.re === undefined && (input.sync?.length ?? 0) > 0 && (access === null || access.can('sync', channel))
    const body = syncs ? { ...input, sync: await Promise.all(input.sync!.map(resolveTarget)) } : input
    let poster = caller
    if (body.channel !== undefined && !body.noSync) {
      const config = await engine.configTargets(body.channel)
      if (config.length > 0) poster = { ...caller, origin: { ...caller.origin, config } } as Caller
    }
    const text = await withEmails(body.text)
    const answer = await backend.post(poster, { ...body, text }, signal)
    // One that can't read where it posted gets back what it sent: who its emails are isn't its to see.
    return text !== input.text && access !== null && !access.readable(answer.message.channel) ? { ...answer, message: { ...answer.message, text: input.text } } : answer
  }

  /**
   * An import's answer, as a sync callback's client gets it: the message it wrote or changed, or the
   * middleware's responses in the event's platform thread and a `DroppedError` when it dropped it.
   */
  async function landed(caller: PlatformCaller, answer: Protocol['syncImport']['output']): Promise<string | null> {
    if (!answer.dropped) return answer.message
    for (const text of answer.dropped) await caller.platform.respond(text)
    throw new DroppedError(answer.dropped)
  }

  /**
   * What a sync callback's client does, on any backend. Its own writes are imports, as the platform
   * user the event came from, which the backend's middleware sees as any import; everything else, its
   * reads included, it does as sync. A change it names by ID is an import that names it so.
   */
  async function asPlatform(name: Method, caller: PlatformCaller, input: unknown, signal: AbortSignal): Promise<unknown> {
    const sync = engine!
    const me = sync.caller
    const { author, key } = caller.platform
    const { via } = caller.origin
    const source = { key, channel: via.channel, thread: via.thread }
    const change = async (body: Protocol['syncImport']['input']) => {
      const message = await landed(caller, await backend.syncImport(me, body, signal))
      if (message === null) throw notFound(`message not found: #${(body as { message?: string }).message}`, 'message_not_found')
      return { ok: true as const }
    }
    switch (name) {
      case 'post':
        return importPost(caller, input as Protocol['post']['input'], signal)
      case 'edit': {
        const { id, text } = input as Protocol['edit']['input']
        return change({ op: 'edit', author, from: null, message: id, text: await withEmails(text), source })
      }
      case 'delete':
        return change({ op: 'delete', author, from: null, message: (input as Protocol['delete']['input']).id })
      case 'react': {
        const { id, emoji, remove } = input as Protocol['react']['input']
        return change({ op: 'react', author, from: null, message: id, emoji, ...(remove !== undefined ? { remove } : {}) })
      }
      case 'label': {
        const { id, set, unset } = input as Protocol['label']['input']
        return change({ op: 'labels', author, from: null, message: id, ...(set ? { set } : {}), ...(unset ? { unset } : {}) })
      }
      default:
        return invoke(name, me, input, signal)
    }
  }

  /** A sync callback's post, as an import by its platform user: once per client ID, which the backend sees to. */
  async function importPost(caller: PlatformCaller, input: Protocol['post']['input'], signal: AbortSignal): Promise<Protocol['post']['output']> {
    const sync = engine!
    const me = sync.caller
    const { author, key } = caller.platform
    const { via } = caller.origin
    const read = async (id: string) => {
      const message = await lookup(me, id, signal)
      if (!message) throw notFound(`message not found: #${id}`, 'message_not_found')
      return message
    }
    // A retry of one that landed: it stands, and its targets were recorded with it.
    if (input.id !== undefined) {
      const found = (await backend.syncFind(me, { post: input.id }, signal)).message
      if (found !== null) return { message: await read(found) }
    }
    const targets = await Promise.all((input.sync ?? []).map(resolveTarget))
    // A new root lands with the targets its channel syncs with, as any post through board() does.
    const config = input.channel !== undefined && !input.noSync ? await sync.configTargets(input.channel) : []
    const importer: Caller = config.length > 0 ? { ...me, origin: { ...me.origin, config } } : me
    const message = await landed(
      caller,
      await backend.syncImport(importer, {
        op: 'post',
        author,
        from: null,
        origin: null,
        source: { key, channel: via.channel, thread: via.thread },
        ...(input.channel !== undefined ? { channel: input.channel } : { re: input.re! }),
        text: await withEmails(input.text),
        ...(input.labels ? { labels: input.labels } : {}),
        ...(input.noSync ? { noSync: true } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        ...(input.id !== undefined ? { id: input.id } : {}),
      }, signal),
    )
    // The targets it asked for, as sync records a thread's.
    for (const target of targets)
      await backend.syncReceipt(me, { kind: 'thread', message: message!, target: target.target, targetKind: target.kind, cause: 'request' }, signal)
    return { message: await read(message!) }
  }

  /** The protocol method `name`, as board() serves it: what it posts and edits with the emails they mention resolved. */
  async function invoke(name: Method, caller: Caller, input: unknown, signal: AbortSignal): Promise<unknown> {
    switch (name) {
      case 'post':
        return post(caller, input as Protocol['post']['input'], signal)
      case 'edit': {
        // Its emails resolve once the backend says the caller may post where the message is, and read it.
        const { id, text } = input as Protocol['edit']['input']
        if (!engine || !mentionsEmails(text) || !(await mayPost(caller, { re: id }, signal))) return backend.edit(caller, { id, text }, signal)
        return backend.edit(caller, { id, text: await withEmails(text) }, signal)
      }
      case 'schedule': {
        const body = input as Protocol['schedule']['input']
        const allowed = engine && mentionsEmails(body.text) ? await mayPost(caller, body, signal) : null
        if (!allowed) return backend.schedule(caller, body, signal)
        const text = await withEmails(body.text)
        const answer = await backend.schedule(caller, { ...body, text }, signal)
        // As for a post: one that can't read where it lands gets back what it sent.
        const { access } = allowed
        return text !== body.text && access !== null && !access.readable(answer.schedule.channel) ? { ...answer, schedule: { ...answer.schedule, text: body.text } } : answer
      }
      case 'inbox': {
        const query = input as Protocol['inbox']['input']
        // A channel by name, for an entry this board has: its platform ID, for a caller that may sync.
        if (engine && entries[query.key] && query.channel !== undefined) {
          const access = await accessOf(caller, signal)
          if (access === null || access.anywhere('sync')) return backend.inbox(caller, { ...query, channel: await engine.inboxChannel(query.key, query.channel) }, signal)
        }
        return backend.inbox(caller, query, signal)
      }
      default: {
        const method = backend[name] as unknown
        if (typeof method !== 'function') throw notFound(`no route: ${name}`)
        return (method as (caller: Caller, input: unknown, signal: AbortSignal) => Promise<unknown>).call(backend, caller, input, signal)
      }
    }
  }

  /**
   * A sign-in that carries a code, where the entry's sync runs: a browser opens it with no token,
   * so the code is all it has. `signIn` sends the person to the platform as whoever the code was
   * issued to; `signedIn`, where the platform sends them back, links the account they approved.
   */
  async function signingIn(name: 'signIn' | 'signedIn', url: URL, signal: AbortSignal): Promise<Response> {
    const { sync: key, code } = SignInQuery.parse(queryObject(url))
    if (!engine || !entries[key]) throw notFound(`no sync entry named ${key}`)
    const page = (status: number, text: string) => new Response(`${text}\n`, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
    const { holder } = await backend.syncFind(engine.caller, { code }, signal)
    if (holder === null) return page(404, "That link has expired or been used. Run `vb identity link` again for a new one.")
    if (name === 'signIn') {
      const back = ownUrl()
      const at = await engine.signIn(key, holder, back ? `${back}/identity/signed-in?${new URLSearchParams({ sync: key, code })}` : undefined)
      return new Response(null, { status: 302, headers: { location: at } })
    }
    const linked = await engine.redeemSignIn(key, holder, code)
    if (!linked) return page(409, `${entries[key]!.platform} hasn't said you approved yet: finish signing in, then open this page again.`)
    return page(200, `Linked ${linked.handle ? `@${linked.handle}` : linked.actor}. You can close this tab.`)
  }

  /** board()'s own routes for a caller: sync's, which run where board() does. */
  async function serve(name: BoardRoute, caller: Caller, request: Request, url: URL, params: Record<string, string>): Promise<Response> {
    const signal = request.signal
    switch (name) {
      case 'sync': {
        // Attaching a thread is a `thread` receipt, recorded as the caller: it needs `sync` where the thread is.
        // Before its target goes to the platform to resolve, the backend says whether a request's caller has
        // it: its copies answer only for messages the caller may sync.
        const body = SyncBody.parse(await readJson(request))
        const id = params.id ?? ''
        if ('request' in caller && engine) {
          const { message: root, replies } = await backend.message(caller, { id }, signal)
          const message = [root, ...replies].find((candidate) => candidate.id === id)
          if (!message) throw notFound(`message not found: #${id}`, 'message_not_found')
          const refused = () => forbidden(`this token can't sync in ${message.channel}`)
          const { copies } = await backend.syncCopies(caller, { message: [message.id] }, signal).catch((error: unknown) => {
            throw error instanceof HttpError && error.status === 403 ? refused() : error
          })
          if (!copies[message.id]) throw refused()
        }
        const target = await resolveTarget(body.target)
        const { attached } = await backend.syncReceipt(caller, { kind: 'thread', message: id, target: target.target, targetKind: target.kind, cause: 'request' }, signal)
        return json({ target: target.target, attached: attached ?? true })
      }
      case 'identityUnlink': {
        // Who may unlink what is the backend's: it answers for the caller's own links.
        const body = IdentityUnlinkBody.parse(await readJson(request))
        const { links } = await backend.identity(caller, {}, signal)
        const wanted = body.actor.replace(/^@/, '').toLowerCase()
        const found = links.filter((link) => link.actor === body.actor || link.handle?.toLowerCase() === wanted).map((link) => link.actor)
        if (found.length === 0) throw notFound(`${body.actor} isn't linked to you`, 'not_linked')
        if (found.length > 1) throw badRequest(`${body.actor} names several of your accounts: use ${found.join(' or ')}`, 'ambiguous_actor')
        await backend.syncUnlink(caller, { account: found[0]! }, signal)
        return json({ ok: true, actor: found[0]! })
      }
      default:
        throw notFound(`no route: ${request.method} ${url.pathname}`)
    }
  }

  engine?.bind({
    backend,
    client: (platform, trigger) => clientAs({ platform: { author: platform.author, key: platform.key, respond: platform.respond }, origin: { via: platform.via } }, trigger),
  })

  /** Server-sent events, from the backend's long-poll: each event's `id` is its cursor, so `Last-Event-ID` resumes exactly. */
  async function sse(caller: Caller, query: Protocol['events']['input'], request: Request): Promise<Response> {
    // The first page now, so a bad cursor or a refusal answers as an error instead of a stream.
    const first = await backend.events(caller, { ...query, wait: 0 }, request.signal)
    const encoder = new TextEncoder()
    const controller = new AbortController()
    const deadline = Date.now() + streamMaxMs
    const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(streamMaxMs)])
    const body = new ReadableStream<Uint8Array>({
      async start(stream) {
        const send = (text: string) => {
          try {
            stream.enqueue(encoder.encode(text))
          } catch {}
        }
        const ping = setInterval(() => send(': ping\n\n'), 15_000)
        try {
          send(': connected\n\n')
          let page = first
          let after: string | undefined
          for (;;) {
            for (const event of page.events) send(`id: ${event.cursor}\nevent: board\ndata: ${JSON.stringify(event)}\n\n`)
            // Filtered-out events still advance the client's cursor with a bare `id:`, the first page's included.
            if (page.cursor !== (page.events.at(-1)?.cursor ?? after)) send(`id: ${page.cursor}\n\n`)
            after = page.cursor
            const left = deadline - Date.now()
            if (signal.aborted || left <= 0) break
            page = await backend.events(caller, { ...query, after, wait: Math.min(300, left / 1000) }, signal)
          }
        } catch (error) {
          if (!signal.aborted) console.error('[vboard] feed failed', error)
        } finally {
          clearInterval(ping)
          try {
            stream.close()
          } catch {}
        }
      },
      cancel() {
        controller.abort()
      },
    })
    return new Response(body, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    })
  }

  async function dispatch(request: Request, injected: Caller | PlatformCaller | null): Promise<Response> {
    try {
      const url = new URL(request.url)
      const match = route(request.method, url.pathname)
      if (!match) throw notFound(`no route: ${request.method} ${url.pathname}`)
      const { target } = match
      if (!injected && !match.root) state.learned = match.base
      const boardUrl = (options.url ?? `${url.origin}${match.base}`).replace(/\/+$/, '')

      if (target.kind === 'board' && target.name === 'webhook') {
        // A platform can't send a board token: its adapter verifies the request.
        if (!engine || !entries[match.params.key ?? '']) throw notFound(`no sync entry named ${match.params.key}`)
        return await engine.handleWebhook(match.params.key!, request)
      }
      if (target.kind === 'board' && (target.name === 'signIn' || target.name === 'signedIn')) return await signingIn(target.name, url, request.signal)
      // A sync callback's client does everything but its own writes as sync.
      const own = injected && 'platform' in injected ? engine!.caller : injected
      if (target.kind === 'board') {
        if (target.name === 'avatar') {
          const name = match.param ?? ''
          if (!(KNOWN_AGENTS as readonly string[]).includes(name)) throw notFound(`no avatar: ${name}`)
          return new Response(avatarSvg(name), {
            headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' },
          })
        }
        if (target.name === 'openapi') return json(openapi())
        return await serve(target.name, own ?? callerOf(request, boardUrl), request, url, match.params)
      }

      if (target.kind === 'backend') return await target.route.handle(request, { caller: own ?? callerOf(request, boardUrl), param: match.param })

      if (typeof (backend[target.name] as unknown) !== 'function') throw notFound(`no route: ${request.method} ${url.pathname}`)
      const caller = own ?? callerOf(request, boardUrl)
      // A file is read only for a caller the backend knows.
      if (target.name === 'upload') await accessOf(caller, request.signal)
      const input = await inputOf(target.name, request, url, match.params)
      if (target.name === 'events' && (request.headers.get('accept') ?? '').includes('text/event-stream'))
        return await sse(caller, input as Protocol['events']['input'], request)
      const output = injected && 'platform' in injected ? await asPlatform(target.name, injected, input, request.signal) : await invoke(target.name, caller, input, request.signal)
      if (target.name === 'attachment') return attachmentResponse(output as Protocol['attachment']['output'])
      return json(output, CREATED.has(target.name) ? 201 : 200)
    } catch (error) {
      return toErrorResponse(error)
    }
  }

  return {
    dispatch,
    async inject(request, caller, trigger, writes) {
      if (trigger !== null && request.method === 'POST' && new URL(request.url).pathname.endsWith('/messages')) {
        const body = ((await request.json()) ?? {}) as Record<string, unknown>
        body.id ??= await derivedId('vboard-inbound', trigger, 'client', String(writes.made++))
        request = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(body) })
      }
      return dispatch(request, caller)
    },
    async run(id, event, { trigger, attempt }) {
      if (id === SYNC && engine) return engine.deliver(event as SyncEvent, { attempt })
      const watcher = watch[id]
      if (!watcher) throw new Error(`this board has no watcher ${id}`)
      await watcher.run({ event, board: handleOf({ self: id, origin: { via: { kind: 'watcher', id } } }, trigger) })
    },
    async receive(key, item, { id, attempt }) {
      if (!engine) throw new Error(`this board has no sync, so nothing reads ${key}'s inbox`)
      await engine.receive(key, item, { id, attempt })
    },
    pull: () => (engine ? engine.pull() : Promise.resolve(0)),
    async readSource(key, target, limit) {
      if (!engine || !entries[key]) throw notFound(`this board doesn't run sync entry ${key}: read it where its sync runs`, 'not_synced_here')
      return engine.readSource(key, target, limit)
    },
    typing: async (messages, status) => (engine ? engine.typing(messages, status) : []),
  }
}
