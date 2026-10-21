import type { z } from 'zod'
import { createServer, type A2Scheduler } from 'experimental-a2/server'
import { boardContract, BOARD_SESSION, inboxSession, SCHEDULES_SESSION } from '../contract/contract.ts'
import { actorsReducer, channelsReducer, linkedTo } from '../contract/reducers.ts'
import { RemoteWatcherId } from '../contract/schemas.ts'
import {
  IdentityCheckBody,
  IdentityLinkBody,
  IdentityUnlinkBody,
  InboxQuery,
  RedriveBody,
  SourceReadQuery,
  SyncBody,
  type IdentityView,
  type Me,
  type StuckEvent,
} from '../api/routes.ts'
import { createSyncEngine } from '../sync/engine.ts'
import type { SyncProvider } from '../sync/provider.ts'
import type { Access } from './access.ts'
import type { Principal } from './auth.ts'
import type { Backend, BackendRoute, BoardBinding, Caller, ProtocolMethods } from './backend.ts'
import { attachmentBody, attachmentNotFound, defaultBlob, readUpload, writeUpload, type BlobStore } from './blob.ts'
import { badRequest, forbidden, HttpError, json, notFound, toErrorResponse } from './errors.ts'
import { indexOf, personView, pollFeed, readableFilter, ref, toMessageFilter, view } from './feed.ts'
import { createReads, tablesConsumer } from './reads.ts'
import { createdBy, createSchedules, type Schedule } from './schedules.ts'
import { defaultStore } from '../store/default.ts'
import { TABLES_CONSUMER } from '../store/sql.ts'
import type { BoardStore, MessageFilter } from '../store/types.ts'
import { compileWatcher, createWatchers, ID, registrantSession } from './watch.ts'
import { ack, pull } from './registered.ts'
import { createRegistry, storedPrincipal, type Registration } from './registry.ts'
import { queryObject, readJson, METHODS } from './routing.ts'
import { publicPost, type Post } from './transport.ts'
import {
  authorizeMessage,
  authorizeOwn,
  authorizePost,
  writeAttach,
  writeDelete,
  writeEdit,
  writeLabels,
  writePost,
  writeReaction,
  deploymentIdentity,
  type Identity,
  type WriteContext,
} from './writes.ts'
import { MIDDLEWARE_ACTOR, type Middleware } from './middleware.ts'

/** `a2()`'s options: the board in this deployment, on A2's log, and everything that runs beside it. */
export type A2Options = {
  /**
   * Where the board keeps its log and tables: `postgres()`, `sqlite()`, or `memory()` from
   * `vboard/backend-a2/store-*`. Omitted: SQLite in development, memory in tests, an error in production.
   */
  store?: BoardStore
  /** Required for sync in production, and for scheduled messages. Mount the backend's `scheduler` as `POST` in its own route. */
  scheduler?: A2Scheduler
  /** Two-way sync, keyed by a name you choose: `{ slack: slack({...}), github: github({...}) }`. */
  sync?: Record<string, SyncProvider>
  /**
   * Runs on every post and edit before it lands, whatever it came from: the API, sync,
   * watchers, schedules. Each calls `next()` to pass the write on; one that doesn't drops it.
   */
  middleware?: readonly Middleware[]
  /**
   * Where attachments live: `vercelBlob()` from `vboard/backend-a2/blob-vercel`. Omitted: memory
   * in tests, `.a2/attachments` in development, and no uploads in production.
   */
  blob?: BlobStore
  /** For tests: how the board POSTs wake-ups to boards on `http()`. Defaults to https to public addresses only. */
  transport?: { post?: Post }
}

const boardServer = (options: A2Options) =>
  createServer({
    contract: boardContract,
    ...(options.store?.log ? { store: options.store.log } : {}),
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
  })

export type BoardSession = ReturnType<ReturnType<typeof boardServer>['session']>

/** What `vb stuck` needs of an A2 session, whatever its contract. */
type Redrivable = {
  deadLetters(): Promise<
    {
      consumer: string
      index: number
      type: string
      lane: string | null
      attemptCount: number
      failureCount: number
      lastError: string | null
      failedAt: Date
    }[]
  >
  redrive(target: { consumer: string; index: number }, options: { action: 'retry' | 'skip' }): Promise<{ redriven: boolean }>
}

const MIDDLEWARE_IDENTITY = deploymentIdentity(MIDDLEWARE_ACTOR, 'middleware')

/** A cursor or message ref in a request, as this board's log index: decimals, from 0. */
function cursorAt(value: string): number {
  const index = indexOf(value)
  if (index === null) throw badRequest(`${value} isn't a cursor or a message ID on this board`, 'invalid_cursor')
  return index
}

/** The message a ref in a request names, as its log index, or a 404 for one that names nothing here. */
function messageAt(value: string): number {
  const index = indexOf(value)
  if (index === null || index === 0) throw notFound(`message not found: #${value}`, 'message_not_found')
  return index
}

/** A schedule's ID, `12` or as the CLI shows it, `s12`, as its index in session `schedules`. */
function scheduleAt(value: string): number {
  const bare = value.replace(/^s/, '')
  const index = indexOf(bare)
  if (index === null || index === 0) throw notFound(`schedule not found: s${bare}`, 'schedule_not_found')
  return index
}

/** A wake-up only has to arrive: the board it wakes runs what it pulls before it answers. */
const WAKE_TIMEOUT_MS = 5000

/**
 * `idempotentId`'s shape, a UUIDv8: the IDs the board derives for its own writes (schedule
 * sends, watchers, sync). They're guessable, so an API caller can't post with one and take it first.
 */
const DERIVED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** A request to the board, as opposed to a write the board's own code makes in-process. */
const fromRequest = (caller: Caller) => 'identity' in caller && (caller.origin.via?.kind ?? 'api') === 'api'

/**
 * Who a caller writes as. This deployment's own code writes as `vboard:client:<name>` from
 * `client(name)`, and as `vboard:watch:<id>` from a watcher, which its own writes never wake.
 */
function identityOf(caller: Caller): Identity {
  if ('identity' in caller) return caller.identity
  const { self, origin } = caller
  if (origin.via?.kind === 'watcher') return deploymentIdentity(`vboard:watch:${self}`, self)
  if (!ID.test(self)) throw badRequest(`client: names use lowercase letters, numbers, - and _, got: ${self}`)
  return deploymentIdentity(`vboard:client:${self}`, self)
}

/** Everything behind a board on `a2()`, built once board() binds it. Nothing in it connects until it's used. */
function build(options: A2Options, binding: BoardBinding) {
  const blob = options.blob ?? defaultBlob()
  const store = options.store ?? defaultStore()
  // The same A2 store object for every server: A2 recognizes its own stores by identity.
  const log = store.log
  const engine =
    options.sync && Object.keys(options.sync).length > 0
      ? createSyncEngine({ entries: options.sync, store: log, scheduler: options.scheduler, blob })
      : null
  const registry = createRegistry({ store: log, scheduler: options.scheduler })
  const post = options.transport?.post ?? publicPost
  // Always, since boards on http() may register watchers here at any time.
  const watchers = createWatchers({
    watch: binding.watch,
    run: (id, event, trigger) => binding.run(id, event, { trigger }),
    store: log,
    scheduler: options.scheduler,
    registered: { state: registry.state, accessNow: (principal) => binding.accessFor(principal), wake },
  })
  const schedules = createSchedules({ store: log, scheduler: options.scheduler })
  const projection = tablesConsumer(store.tables)
  // The tables, watchers, and sync each keep their own place in the board's log.
  const consumers = [projection, watchers.boardConsumer, engine?.outbound].filter((consumer) => consumer !== undefined)
  const server = createServer({
    contract: boardContract,
    ...(log ? { store: log } : {}),
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
    consumers,
  })
  const session = server.session(BOARD_SESSION)
  const reads = createReads(store.tables, session, projection)
  const writes: WriteContext = {
    session,
    reads,
    configTargets: engine ? engine.configTargets : async () => [],
    ...(engine ? { findByEmail: engine.findByEmail } : {}),
    normalizeTarget: engine
      ? engine.normalizeTarget
      : async () => {
          throw badRequest('this board has no sync configured')
        },
    middleware: options.middleware ?? [],
    middlewareClient: () => binding.client({ identity: MIDDLEWARE_IDENTITY, origin: { via: { kind: 'middleware' } } }, null),
  }
  engine?.bind({ session, writes, clientAs: (identity, trigger, origin) => binding.client({ identity, origin }, trigger) })
  // A schedule sends only under the verifier that made it; board()'s `accessFor` says so.
  schedules.bind({ writes, accessNow: binding.accessFor })
  watchers.bind({ reads })

  /** The sessions whose consumers run on lanes, so a dead letter there stops the rest of its lane. */
  async function lanedSessions(): Promise<{ id: string; session: Redrivable }[]> {
    const ids: [string, { session(id: string): Redrivable }][] = [
      [BOARD_SESSION, server],
      [SCHEDULES_SESSION, schedules.server],
      ...(await watchers.sessions()).map((id): [string, typeof watchers.server] => [id, watchers.server]),
      ...(engine ? (await engine.inboxChannels()).map((channel): [string, typeof engine.inboxServer] => [inboxSession(channel), engine.inboxServer]) : []),
    ]
    return ids.map(([id, owner]) => ({ id, session: owner.session(id) }))
  }

  async function stuck(): Promise<StuckEvent[]> {
    const found = (await Promise.all((await lanedSessions()).map(async ({ id, session }) => (await session.deadLetters()).map((dead) => ({ id, dead }))))).flat()
    if (found.length === 0) return []
    // The tables first: reads and writes wait on them, so they're what to retry first.
    found.sort((a, b) => Number(b.dead.consumer === TABLES_CONSUMER) - Number(a.dead.consumer === TABLES_CONSUMER))
    // A thread's key is its root's post's event ID.
    const roots = new Map<string, string | null>()
    const rootOf = async (thread: string) => {
      if (!roots.has(thread)) {
        const root = await store.tables.byEventId(thread)
        roots.set(thread, root ? ref(root.id) : null)
      }
      return roots.get(thread)!
    }
    return Promise.all(found.map(async ({ id, dead }) => {
      const laneThread = dead.lane?.startsWith('thread:') ? dead.lane.slice('thread:'.length) : null
      // An inbox's lanes are platform threads; everywhere else they're the board's.
      const inbox = id.startsWith('inbox:')
      const thread = inbox ? (laneThread && (await store.tables.threadOf(laneThread))) : laneThread
      return {
        session: id,
        index: dead.index,
        consumer: dead.consumer,
        type: dead.type,
        lane: dead.lane,
        thread,
        root: thread === null ? null : await rootOf(thread),
        external: inbox ? laneThread : null,
        attempts: dead.attemptCount,
        failures: dead.failureCount,
        error: dead.lastError,
        failedAt: dead.failedAt.toISOString(),
      }
    }))
  }

  async function redrive(body: z.infer<typeof RedriveBody>, by: string) {
    const target = (await lanedSessions()).find(({ id }) => id === body.session)
    if (!target) throw notFound(`no session ${body.session} on this board`)
    // Without a consumer, every consumer the event is stuck for.
    const consumers =
      body.consumer !== undefined
        ? [body.consumer]
        : (await target.session.deadLetters()).filter((dead) => dead.index === body.index).map((dead) => dead.consumer)
    const done: string[] = []
    for (const consumer of consumers) {
      const { redriven } = await target.session.redrive({ consumer, index: body.index }, { action: body.action })
      if (redriven) done.push(consumer)
    }
    if (done.length > 0)
      console.info(`[vboard] ${by} ${body.action === 'retry' ? 'retried' : 'skipped'} stuck event ${body.session}#${body.index} for ${done.join(', ')}`)
    return { redriven: done.length > 0 }
  }

  /** The board's own bookkeeping spans every channel, so it needs `manage` in all of them. */
  const requireManage = (principal: Principal, what: string) => {
    if (!principal.access.everywhere('manage'))
      throw forbidden(`this token can't ${what}: it needs manage in every channel`)
  }

  /**
   * Whether `principal` may have a file: one it uploaded, or one a message it
   * can read carries. A deleted message drops its files, so it no longer counts.
   */
  async function attachmentReadable(principal: Principal, id: string, uploadedBy: string | null) {
    if (principal.access.readsAll || uploadedBy === principal.id) return true
    await reads.ensure()
    return (await reads.tables.withAttachment(id)).some((message) => principal.access.readable(message.channel))
  }

  /**
   * `filter`, narrowed to the channels `access` reads among those the log has,
   * and the index that list reflects: a read's cursor goes no further, or the
   * first post in a channel newer than the list would be in neither the page
   * nor the feed after it.
   */
  async function readable(filter: MessageFilter, access: Access): Promise<{ filter: MessageFilter; through: number }> {
    if (access.readsAll) return { filter, through: Number.POSITIVE_INFINITY }
    const { state, index } = await session.state(channelsReducer)
    return { filter: readableFilter(filter, Object.keys(state), access), through: index }
  }

  /** Who wrote, was mentioned, or reacted in the channels `access` reads, a page at a time. */
  async function actorsIn(access: Access): Promise<Set<string>> {
    const ids = new Set<string>()
    const { filter } = await readable({}, access)
    for (let before: number | undefined; ; ) {
      const { messages } = await reads.messages(filter, { limit: 500, ...(before !== undefined ? { before } : {}) })
      for (const message of messages) {
        ids.add(message.by.actor)
        for (const id of message.mentions) ids.add(id)
        for (const reactors of Object.values(message.reactions)) for (const id of reactors) ids.add(id)
      }
      if (messages.length < 500) return ids
      before = messages[0]!.id
    }
  }

  /** Files a write carries, as the board stored them: each one the caller may have, or 404 as if it didn't exist. */
  const attachmentsFor = (principal: Principal, ids: readonly string[] | undefined) =>
    Promise.all(
      [...new Set(ids ?? [])].map(async (id) => {
        const { attachment, uploadedBy } = await readUpload(blob, id)
        if (!(await attachmentReadable(principal, id, uploadedBy))) throw attachmentNotFound(id)
        return attachment
      }),
    )

  /**
   * Tells a registrant's board it has matches to pull, with no event and no token in it: its
   * board pulls them with its own credentials. The hash says whether its registration is stale.
   * Says whether the wake-up got there: an answer, or still pulling when the wait ran out.
   */
  async function wake(registration: Registration): Promise<boolean> {
    if (registration.url === null) return true
    try {
      const response = await post(`${registration.url}/wake`, {
        headers: { 'content-type': 'application/json', 'x-board-watchers': registration.hash },
        body: '{}',
        // Its board runs what it pulls before it answers; the wake-up only has to arrive.
        signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
      })
      if (response.ok) return true
      console.error(`[vboard] couldn't wake ${registration.url}: ${response.status}`)
      return false
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') return true
      console.error(`[vboard] couldn't wake ${registration.url}:`, (error as Error).message)
      return false
    }
  }
  /** A registrant's queue, in the watch contract. */
  const queueOf = (owner: string) => watchers.server.session(registrantSession(owner)) as never

  const methods: ProtocolMethods = {
    async me(caller) {
      const { principal, author, actor } = identityOf(caller)
      const body: Me = {
        actor: actor.id,
        principal: principal.id,
        kind: actor.kind,
        handle: actor.handle,
        name: actor.name,
        avatar: actor.avatar,
        profile: author.profile,
        session: author.session,
        expiresAt: principal.expiresAt?.toISOString() ?? null,
        can: principal.access.summary(),
      }
      return body
    },
    async channels(caller) {
      const { principal } = identityOf(caller)
      const { state, index } = await session.state(channelsReducer)
      const channels = Object.values(state)
        .filter((channel) => principal.access.readable(channel.path))
        .sort((a, b) => a.path.localeCompare(b.path))
      return { channels, cursor: ref(index) }
    },
    async actors(caller) {
      const { principal, actor } = identityOf(caller)
      const { state, index } = await session.state(actorsReducer)
      // A reader of every channel sees everyone; anyone else, who wrote, was mentioned, or reacted where they read, and themselves.
      let seen: ((id: string) => boolean) | null = null
      if (!principal.access.readsAll) {
        const ids = await actorsIn(principal.access)
        ids.add(actor.id)
        seen = (id) => ids.has(id)
      }
      const actors = Object.values(state.byId)
        .filter((a) => seen === null || seen(a.id))
        .sort((a, b) => a.handle.localeCompare(b.handle))
        .map((a) => {
          const person = personView(state, a.id)
          return person ? { ...a, person } : a
        })
      return { actors, cursor: ref(index) }
    },
    async identity(caller) {
      const { principal } = identityOf(caller)
      const { state, index } = await session.state(actorsReducer)
      const links = linkedTo(state, principal.id).map((id) => ({
        actor: id,
        handle: state.byId[id]?.handle ?? null,
        name: state.byId[id]?.name ?? null,
        method: state.links[id]!.method,
        at: state.links[id]!.at,
      }))
      const unlinked = Object.entries(options.sync ?? {})
        .filter(([, entry]) => !links.some((link) => link.actor.startsWith(`${entry.platform}:user:`)))
        .map(([key]) => key)
      const body: IdentityView = { principal: principal.id, links, unlinked, cursor: ref(index) }
      return body
    },
    async messages(caller, query) {
      const { principal, actor } = identityOf(caller)
      const { state: actors } = await session.state(actorsReducer)
      const { filter, through } = await readable(toMessageFilter(query, { me: actor.id, actors }), principal.access)
      const { messages, position } = await reads.messages(filter, {
        ...(query.before !== undefined ? { before: cursorAt(query.before) } : {}),
        ...(query.after !== undefined ? { after: cursorAt(query.after) } : {}),
        limit: query.limit ?? 50,
      })
      const reader = await reads.reader(principal.access, messages)
      return { messages: messages.map((m) => view(m, actors, reader)), cursor: ref(Math.min(position, through)) }
    },
    async threads(caller, query) {
      const { principal, actor } = identityOf(caller)
      const { state: actors } = await session.state(actorsReducer)
      const { filter, through } = await readable(toMessageFilter(query, { me: actor.id, actors }), principal.access)
      const { threads, position } = await reads.threads(filter, {
        ...(query.after !== undefined ? { after: cursorAt(query.after) } : {}),
        limit: query.limit ?? 50,
      })
      const reader = await reads.reader(principal.access, threads.flatMap((t) => (t.last ? [t.root, t.last] : [t.root])))
      return {
        threads: threads.map((t) => ({ message: view(t.root, actors, reader), replies: t.replies, last: t.last && view(t.last, actors, reader) })),
        cursor: ref(Math.min(position, through)),
      }
    },
    async message(caller, { id }, signal) {
      const { principal } = identityOf(caller)
      const at = messageAt(id)
      const message = await reads.message(at, signal)
      if (!message || !principal.access.readable(message.channel)) throw notFound(`message not found: #${at}`, 'message_not_found')
      const [{ messages, cursor }, { state: actors }] = await Promise.all([reads.thread(message.re ?? message.id, signal), session.state(actorsReducer)])
      const [root, ...replies] = messages
      const reader = await reads.reader(principal.access, messages)
      return {
        message: view(root!, actors, reader),
        replies: replies.map((reply) => view(reply, actors, reader)),
        cursor: ref(cursor),
        schedules: await schedules.forThread(root!.id),
      }
    },
    async post(caller, parsed) {
      const identity = identityOf(caller)
      const { principal } = identity
      const body = { ...parsed, re: parsed.re === undefined ? undefined : messageAt(parsed.re) }
      const proofs = await authorizePost(writes, principal.access, body)
      if (fromRequest(caller) && body.id !== undefined && DERIVED_ID.test(body.id))
        throw badRequest("id: UUIDv8s are the board's own, for the writes it makes itself")
      // A client elsewhere derives its posts' IDs from its key, under its own principal, so no
      // one else can post with one first and make its retry fail.
      if (fromRequest(caller) && body.id?.startsWith('key:') && !body.id.startsWith(`key:${principal.id}:`))
        throw badRequest(`id: key:… IDs derive from a client's key, and this token's are key:${principal.id}:…`)
      const attachments = await attachmentsFor(principal, body.attachments)
      const { unknownMentions, ...message } = await writePost(writes, {
        attachments,
        identity,
        proofs,
        channel: body.channel,
        re: body.re,
        text: body.text,
        labels: body.labels,
        noSync: body.noSync,
        id: body.id,
        sync: body.sync,
        ...caller.origin,
      })
      return { message, ...(unknownMentions ? { unknownMentions } : {}) }
    },
    async edit(caller, { id, text }) {
      const identity = identityOf(caller)
      const authorized = await authorizeOwn(writes, identity.principal, messageAt(id), 'edit')
      const { unknownMentions } = await writeEdit(writes, { identity, authorized, text, ...caller.origin })
      return { ok: true, ...(unknownMentions ? { unknownMentions } : {}) }
    },
    async delete(caller, { id }) {
      const identity = identityOf(caller)
      const authorized = await authorizeOwn(writes, identity.principal, messageAt(id), 'delete')
      await writeDelete(writes, { identity, authorized })
      return { ok: true }
    },
    async react(caller, { id, emoji, remove }) {
      const identity = identityOf(caller)
      const authorized = await authorizeMessage(writes, identity.principal.access, 'react', messageAt(id))
      await writeReaction(writes, { identity, authorized, emoji, remove })
      return { ok: true }
    },
    async label(caller, { id, set, unset }) {
      const identity = identityOf(caller)
      const authorized = await authorizeMessage(writes, identity.principal.access, 'label', messageAt(id))
      await writeLabels(writes, { identity, authorized, set, unset })
      return { ok: true }
    },
    async typing(caller, { id, status }) {
      const { principal } = identityOf(caller)
      // Typing is a reply about to come: `post` and `read` where the thread is.
      const at = messageAt(id)
      const { message } = await authorizeMessage(writes, principal.access, 'post', at)
      if (message.deleted) throw notFound(`message not found: #${at}`, 'message_not_found')
      return { targets: engine ? await engine.typing(message.thread, status) : [] }
    },
    async schedule(caller, parsed) {
      const identity = identityOf(caller)
      const body = { ...parsed, re: parsed.re === undefined ? undefined : messageAt(parsed.re) }
      // Checked now, where the caller sees it, and again at every send.
      await authorizePost(writes, identity.principal.access, body)
      const attachments = await attachmentsFor(identity.principal, body.attachments)
      return schedules.create(identity, body, attachments)
    },
    async schedules(caller, query) {
      const { principal } = identityOf(caller)
      let root: number | undefined
      if (query.re !== undefined) {
        const at = messageAt(query.re)
        root = (await authorizeMessage(writes, principal.access, 'read', at)).message.re ?? at
      }
      const visible = (schedule: Schedule) => principal.access.readable(schedule.channel) || createdBy(schedule, principal)
      return { schedules: await schedules.list({ ...query, ...(root !== undefined ? { root } : {}) }, visible) }
    },
    async cancelSchedule(caller, { id }) {
      return schedules.cancel(identityOf(caller), scheduleAt(id))
    },
    async upload(caller, { data, name, type }) {
      const { principal } = identityOf(caller)
      // A file is no use until a post carries it, so uploading needs `post` somewhere.
      if (!principal.access.anywhere('post')) throw forbidden("this token can't post anywhere, so it can't upload")
      return { attachment: await writeUpload(blob, { data, name, type, uploadedBy: principal.id }) }
    },
    async attachment(caller, { id }) {
      const { principal } = identityOf(caller)
      const { attachment, uploadedBy } = await readUpload(blob, id)
      if (!(await attachmentReadable(principal, attachment.id, uploadedBy))) throw attachmentNotFound(attachment.id)
      return { attachment, data: await attachmentBody(blob, attachment.id) }
    },
    async watchers(caller) {
      const { principal } = identityOf(caller)
      // Each names a board's URL and tails: all of them only for `manage` in every channel, the caller's own for anyone.
      const all = await registry.list()
      return { watchers: principal.access.everywhere('manage') ? all : all.filter((found) => found.owner === principal.id) }
    },
    async register(caller, body) {
      const { principal } = identityOf(caller)
      // A registered watcher sees only what its registrant may read.
      if (!principal.access.anywhere('read'))
        throw forbidden("this token can't read anywhere, so a watcher it registers would see nothing")
      for (const [id, spec] of Object.entries(body.watch)) {
        const name = RemoteWatcherId.safeParse(id)
        if (!name.success) throw badRequest(`watch ${id}: ${name.error.issues[0]!.message}`, 'bad_watcher')
        try {
          compileWatcher(id, spec)
        } catch (error) {
          throw badRequest((error as Error).message, 'bad_watcher')
        }
      }
      return registry.register(storedPrincipal(principal), { url: body.url ?? null, watch: body.watch })
    },
    async matches(caller, query, signal) {
      const { principal } = identityOf(caller)
      if (!(await registry.state()).byOwner[principal.id]) throw notFound('this token has no watchers registered here', 'no_registration')
      const queue = queueOf(principal.id)
      const pulling = { access: principal.access, limit: query.limit ?? 10, timers: options.scheduler !== undefined }
      const deadline = Date.now() + (query.wait ?? 0) * 1000
      for (let pause = 100; ; pause = Math.min(pause * 2, 1000)) {
        const matches = await pull(queue, { ...pulling, now: Date.now() })
        if (matches.length > 0 || Date.now() >= deadline || signal.aborted) return { matches }
        await new Promise((resolve) => setTimeout(resolve, Math.min(pause, Math.max(0, deadline - Date.now()))))
      }
    },
    async ack(caller, { id, ...body }) {
      const { principal } = identityOf(caller)
      const result = await ack(queueOf(principal.id), id, body, { now: Date.now(), timers: options.scheduler !== undefined })
      if (result === 'gone') throw notFound(`no match ${id} is waiting for this token`, 'no_match')
      if (result === 'stale') throw new HttpError(409, 'stale_lease', 'that lease ran out, and the match was pulled again')
      return { ok: true }
    },
    async events(caller, query, signal) {
      const { principal, actor } = identityOf(caller)
      const after = query.after !== undefined ? cursorAt(query.after) : undefined
      const { state: actors } = await session.state(actorsReducer)
      const feed = { session, reads, after, filters: query, all: query.all ?? false, me: actor.id, actors, access: principal.access }
      const { events, cursor } = await pollFeed(feed, (query.wait ?? 0) * 1000, signal)
      return { events, cursor: ref(cursor) }
    },
  }

  const needSync = () => {
    if (!engine) throw notFound('this board has no sync configured')
    return engine
  }

  /** a2()'s routes beside the protocol, by name. The sync ones move to board() with sync. */
  const handlers = {
    async stuck(caller: Caller) {
      // What failed, with its errors, like the inbox.
      requireManage(identityOf(caller).principal, 'read stuck events')
      return json({ stuck: await stuck() })
    },
    async redrive(caller: Caller, request: Request) {
      const { principal, actor } = identityOf(caller)
      requireManage(principal, 'retry or skip stuck events')
      return json(await redrive(RedriveBody.parse(await readJson(request)), actor.id))
    },
    async sync(caller: Caller, request: Request, param: string) {
      const identity = identityOf(caller)
      const authorized = await authorizeMessage(writes, identity.principal.access, 'sync', messageAt(param))
      const body = SyncBody.parse(await readJson(request))
      return json(await writeAttach(writes, { identity, authorized, target: body.target }))
    },
    async inbox(caller: Caller, request: Request, param: string) {
      // Raw platform payloads, from every channel.
      requireManage(identityOf(caller).principal, 'read the inbox')
      const query = InboxQuery.parse(queryObject(new URL(request.url)))
      return json({ events: await needSync().readInbox(param, query.channel, query.limit ?? 50) })
    },
    async sourceRead(caller: Caller, request: Request, param: string) {
      // The app's token reads what the app can, not what the caller can.
      requireManage(identityOf(caller).principal, 'read a source')
      const sync = needSync()
      const query = SourceReadQuery.parse(queryObject(new URL(request.url)))
      return json(await sync.readSource(param, query.target, query.limit ?? 50))
    },
    // Platforms can't send a board token: the adapter verifies the request.
    webhook: (request: Request, param: string) => needSync().handleWebhook(param, request),
    async identityLink(caller: Caller, request: Request) {
      const sync = needSync()
      const body = IdentityLinkBody.parse(await readJson(request))
      return json(await sync.startLink(identityOf(caller), body.sync, body.method))
    },
    async identityCheck(caller: Caller, request: Request) {
      const sync = needSync()
      const body = IdentityCheckBody.parse(await readJson(request))
      return json({ linked: await sync.checkLink(identityOf(caller), body.sync) })
    },
    async identityUnlink(caller: Caller, request: Request) {
      const { principal, author } = identityOf(caller)
      if (principal.kind !== 'person') throw forbidden('only people link platform accounts')
      const body = IdentityUnlinkBody.parse(await readJson(request))
      const { state } = await session.state(actorsReducer)
      const mine = linkedTo(state, principal.id)
      const wanted = body.actor.replace(/^@/, '').toLowerCase()
      const found = mine.filter((id) => id === body.actor || state.byId[id]?.handle.toLowerCase() === wanted)
      if (found.length === 0) throw notFound(`${body.actor} isn't linked to you`, 'not_linked')
      if (found.length > 1) throw badRequest(`${body.actor} names several of your accounts: use ${found.join(' or ')}`, 'ambiguous_actor')
      await session.append({ type: 'actor.unlinked', payload: { actor: found[0]!, by: author } })
      return json({ ok: true, actor: found[0]! })
    },
  }

  const servers = [server, ...(engine ? [engine.inboxServer] : []), schedules.server, registry.server, watchers.server]
  return {
    methods,
    handlers,
    schedules,
    /** The scheduler's callback, for every A2 server behind the board. */
    scheduler: options.scheduler
      ? options.scheduler.handler(...servers)
      : async (_request: Request) => toErrorResponse(notFound('this board has no scheduler')),
    servers,
    engine,
    session,
    store,
  }
}

/**
 * The board in this deployment, on A2's log: its store, scheduler, sync, middleware, and
 * attachments. It's the backend itself: pass it to `board({ backend })`, and mount its
 * `scheduler` in a route of its own. Nothing is built or connected until board() binds it.
 */
export function a2(options: A2Options = {}) {
  let built: ReturnType<typeof build> | null = null
  const ready = () => {
    if (!built) throw new Error("a2: this backend isn't serving a board yet: pass it to board({ backend })")
    // The first call on an instance starts the schedules catching up, and doesn't wait.
    built.schedules.catchUp()
    return built
  }
  const methods = Object.fromEntries(
    METHODS.map((name) => [name, (caller: Caller, input: never, signal: AbortSignal) => (ready().methods[name] as (...args: unknown[]) => unknown)(caller, input, signal)]),
  ) as unknown as ProtocolMethods
  /** A route that needs a verified caller. */
  const authed = (method: 'GET' | 'POST', path: string, handle: (caller: Caller, request: Request, param: string) => Promise<Response>): BackendRoute => ({
    method,
    path,
    auth: true,
    handle: (request, { caller, param }) => handle(caller!, request, param ?? ''),
  })
  const routes: BackendRoute[] = [
    authed('GET', '/stuck', (caller) => ready().handlers.stuck(caller)),
    authed('POST', '/stuck/redrive', (caller, request) => ready().handlers.redrive(caller, request)),
    authed('POST', '/messages/:id/sync', (caller, request, param) => ready().handlers.sync(caller, request, param)),
    authed('GET', '/inbox/:key', (caller, request, param) => ready().handlers.inbox(caller, request, param)),
    authed('GET', '/sources/:key/read', (caller, request, param) => ready().handlers.sourceRead(caller, request, param)),
    { method: 'POST', path: '/webhooks/:key', auth: false, handle: (request, { param }) => ready().handlers.webhook(request, param ?? '') },
    authed('POST', '/identity/link', (caller, request) => ready().handlers.identityLink(caller, request)),
    authed('POST', '/identity/check', (caller, request) => ready().handlers.identityCheck(caller, request)),
    authed('POST', '/identity/unlink', (caller, request) => ready().handlers.identityUnlink(caller, request)),
  ]
  const backend = {
    ...methods,
    remote: null,
    sync: Object.entries(options.sync ?? {}).map(([key, entry]) => ({ key, platform: entry.platform })),
    routes,
    bind(binding: BoardBinding) {
      if (built) throw new Error('a2: this backend already serves a board: create one a2() per board()')
      built = build(options, binding)
    },
    /** The scheduler's callback: `export { scheduler as POST }` from a route of its own. A board without a scheduler answers 404. */
    scheduler: (request: Request): Promise<Response> => ready().scheduler(request),
    /** The A2 servers behind this board, to share one scheduler with other A2 servers. */
    get servers() {
      return ready().servers
    },
    /** For tests and tools. */
    get engine() {
      return ready().engine
    },
    get session() {
      return ready().session
    },
    get store() {
      return ready().store
    },
  }
  // What tests and tools look at stays out of a spread, so `{ ...a2(), delete }` is a backend too.
  for (const key of ['servers', 'engine', 'session', 'store']) Object.defineProperty(backend, key, { enumerable: false })
  return backend satisfies Backend
}

export type A2Backend = ReturnType<typeof a2>
