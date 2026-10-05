import { canonicalEmoji } from '../contract/emoji.ts'
import type { Attachment as ChatAttachment, Chat, Message as ChatMessage, ReactionEvent } from 'chat'
import { idempotentId } from 'experimental-a2'
import { createServer, type A2Scheduler, type A2Store, type HandlerContext } from 'experimental-a2/server'
import type { BoardClient } from '../client/client.ts'
import {
  inboxContract,
  inboxSession,
  type BoardEvents,
  type ExternalEvent,
  type ExternalFile,
  type InboxEvent,
} from '../contract/contract.ts'
import {
  actorsReducer,
  externalMessageKey,
  isThreadTarget,
  messagesReducer,
  syncReducer,
  type ActorsState,
  type ExternalCopy,
  type Message,
} from '../contract/reducers.ts'
import { fileSize, typeOf } from '../contract/files.ts'
import { ATTACHMENT_BYTES_MAX, ATTACHMENTS_PER_MESSAGE_MAX, MESSAGE_TEXT_MAX, type Attachment } from '../contract/schemas.ts'
import { readAttachmentData, writeUpload, type BlobStore } from '../server/blob.ts'
import type { Principal } from '../server/auth.ts'
import type { BoardSession } from '../server/board.ts'
import { badRequest, notFound } from '../server/errors.ts'
import {
  writeDelete,
  writeEdit,
  writeLabels,
  writePost,
  writeReaction,
  type Identity,
  type WriteContext,
} from '../server/writes.ts'
import { type SyncPlatform } from './types.ts'
import { SyncOverrides, immutable, type SyncRoot, type ProviderEvent, type SyncResult } from './events.ts'
import type { ProviderMapping, ResolvedTarget, SyncClient, SyncContext } from './provider.ts'
import { ChannelPath } from '../contract/schemas.ts'

export type BoardBinding = {
  session: BoardSession
  writes: WriteContext
  /** A vboard client writing as `identity`, with write IDs derived from `trigger`. */
  clientAs(identity: Identity, trigger: string): BoardClient
}

/** `files`: a message with files may have no text. */
const clampText = (text: string, files = false) => {
  const trimmed = text.trim() === '' ? (files ? '' : '(no text)') : text
  return trimmed.length > MESSAGE_TEXT_MAX ? `${trimmed.slice(0, MESSAGE_TEXT_MAX - 1)}…` : trimmed
}

/** A Chat SDK attachment as the inbox keeps it: what the adapter needs to fetch it again, without the bytes or the closure. */
const externalFile = (a: ChatAttachment): ExternalFile => ({
  type: a.type,
  ...(a.name ? { name: a.name.slice(0, 1000) } : {}),
  ...(a.mimeType ? { mimeType: a.mimeType.slice(0, 255) } : {}),
  ...(typeof a.size === 'number' && Number.isInteger(a.size) && a.size >= 0 ? { size: a.size } : {}),
  ...(a.url && a.url.length <= 4000 ? { url: a.url } : {}),
  ...(a.fetchMetadata ? { fetchMetadata: a.fetchMetadata } : {}),
})

/** A platform file the board couldn't bring over gets a line in the text instead. */
const fileNote = (file: ExternalFile, why: string) =>
  `📎 ${file.name ?? 'a file'}${file.size !== undefined ? ` (${fileSize(file.size)})` : ''} didn't come over: ${why}`

/** A platform message's text with its file notes after it. */
const withNotes = (text: string, notes: string[]) =>
  notes.length ? `${text.trim() ? `${text}\n\n` : ''}${notes.join('\n')}` : text

/** The file notes in a message's text, so a platform edit (which only knows the text it shows) keeps them. */
const notesIn = (text: string) => text.split('\n').filter((line) => /^📎 .* didn't come over: /u.test(line))

/** Tries per file before it's noted instead: a retry repeats the whole message, so keep it short. */
const FILE_ATTEMPTS = 3

const jsonSafe = (value: unknown): unknown => {
  try {
    return JSON.parse(JSON.stringify(value ?? null))
  } catch {
    return null
  }
}

const emojiName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_+-]/g, '_')
    .slice(0, 64) || 'unknown'

/** Two-way sync between the board and its platforms, one Chat SDK instance per entry. */
export function createSyncEngine(options: {
  entries: Record<string, SyncPlatform>
  store?: A2Store | undefined
  scheduler?: A2Scheduler | undefined
  /** Where attachments' bytes are, for platforms that take uploads. */
  blob?: BlobStore | null
}) {
  const entries = options.entries
  let binding: BoardBinding | null = null
  const bound = () => {
    if (!binding) throw new Error('sync engine used before the board bound it')
    return binding
  }

  const platformOf = (key: string): SyncPlatform => {
    const platform = entries[key]
    if (!platform) throw badRequest(`no sync entry named ${key}`)
    return platform
  }
  const keyOf = (target: string) => target.slice(0, target.indexOf(':'))
  /** `slack:C0123:1727.1` (Chat SDK) → `${key}:C0123:1727.1` (board). */
  const toExternal = (key: string, chatId: string) => {
    const id = chatId.slice(chatId.indexOf(':') + 1)
    return `${key}:${platformOf(key).transport.fromChatId?.(id) ?? id}`
  }
  /** The reverse: board external ID → Chat SDK ID. */
  const toChat = (external: string) => {
    const key = keyOf(external)
    const platform = platformOf(key)
    const id = external.slice(key.length + 1)
    return `${platform.adapter.name}:${platform.transport.toChatId?.(id) ?? id}`
  }

  // --- mappings ---------------------------------------------------------------

  type Mapping = ProviderMapping
  /** How long a key that didn't resolve (say, a Slack channel that doesn't exist yet) waits before another try. */
  const RETRY_MS = 60_000
  const resolved = new Map<string, { map: Promise<Map<string, Mapping>>; complete: boolean; at: number }>()
  /**
   * External channel → board channel or inbound function, for one entry. Each key
   * resolves on its own: one that can't is logged and skipped, and the rest sync.
   */
  const mappings = (key: string) => {
    const cached = resolved.get(key)
    if (cached && (cached.complete || Date.now() - cached.at < RETRY_MS)) return cached.map
    const platform = platformOf(key)
    const pairs = Object.entries(platform.mappings)
    const entry = { complete: true, at: Date.now(), map: Promise.resolve(new Map<string, Mapping>()) }
    entry.map = Promise.allSettled(pairs.map(([raw]) => platform.resolveChannel(raw))).then((results) => {
      const map = new Map<string, Mapping>()
      results.forEach((result, i) => {
        const [raw, target] = pairs[i]!
        if (result.status === 'fulfilled') map.set(`${key}:${result.value}`, target)
        else {
          entry.complete = false
          console.warn(`[vboard] sync ${key}: skipping ${raw}: ${(result.reason as Error).message}`)
        }
      })
      return map
    })
    resolved.set(key, entry)
    return entry.map
  }

  async function configTargets(channel: string): Promise<ResolvedTarget[]> {
    const targets: ResolvedTarget[] = []
    for (const [key, platform] of Object.entries(entries)) {
      if (!platform.canStartThreads) continue
      for (const [external, target] of await mappings(key)) if (target.channel === channel) targets.push({ target: external, channel: external, kind: 'channel' })
    }
    return targets
  }

  async function normalizeTarget(target: string): Promise<ResolvedTarget> {
    const at = target.indexOf(':')
    if (at <= 0) throw badRequest(`sync targets look like <key>:<channel or thread>, got: ${target}`)
    const key = target.slice(0, at)
    const platform = platformOf(key)
    try {
      const resolved = await platform.resolveTarget(target.slice(at + 1))
      return { target: `${key}:${resolved.target}`, channel: `${key}:${resolved.channel}`, kind: resolved.kind }
    } catch (error) {
      throw badRequest(`can't sync to ${target}: ${(error as Error).message}`)
    }
  }

  // --- inbound: platform → inbox --------------------------------------------------

  const chats = new Map<string, Chat>()

  async function intake(key: string, event: ExternalEvent, raw: unknown, dedupe: string) {
    const map = await mappings(key)
    const { state: sync } = await bound().session.state(syncReducer)
    if (!map.has(event.channel) && !sync.byExternalThread[event.thread]) return
    const id = await idempotentId('vboard-inbox', key, dedupe)
    await inboxServer.session(inboxSession(event.channel)).append({
      type: 'external.received',
      id,
      payload: { sync: key, event, raw: jsonSafe(raw) },
    })
  }

  function located(key: string, platform: SyncPlatform, chatThread: string) {
    const precise = toExternal(key, chatThread)
    const platformThread = precise.slice(key.length + 1)
    const grouped = `${key}:${platform.groupThread(platformThread)}`
    const channel = platform.transport.channelOf
      ? `${key}:${platform.transport.channelOf(platformThread)}`
      : toExternal(key, platform.adapter.channelIdFromThreadId(chatThread))
    return { channel, thread: grouped, subthread: grouped === precise ? null : precise, platformThread }
  }

  for (const [key, platform] of Object.entries(entries)) {
    const chat = platform.createChat()
    const authorOf = async (message: ChatMessage) => {
      const author = platform.author(message.author, message.raw)
      const avatar = await platform.transport.avatar?.(message).catch(() => null)
      return avatar ? { ...author, avatar } : author
    }
    const onMessage = async (_thread: unknown, message: ChatMessage) => {
      const where = located(key, platform, message.threadId)
      await intake(
        key,
        {
          kind: 'message',
          ...where,
          message: message.id,
          isRoot: platform.isRoot(where.platformThread, message.id),
          text: platform.markdown(message),
          context: platform.context(message),
          author: await authorOf(message),
          ...(message.attachments?.length ? { files: message.attachments.slice(0, 20).map(externalFile) } : {}),
        },
        message.raw,
        `message:${where.subthread ?? where.thread}|${message.id}`,
      )
    }
    chat.onNewMessage(/[\s\S]*/, onMessage)
    chat.onNewMention(onMessage)
    chat.onMessageUpdated(async (_thread, message) => {
      const where = located(key, platform, message.threadId)
      await intake(
        key,
        {
          kind: 'edited',
          channel: where.channel,
          thread: where.thread,
          subthread: where.subthread,
          message: message.id,
          text: platform.markdown(message),
          author: await authorOf(message),
        },
        message.raw,
        `edited:${where.subthread ?? where.thread}|${message.id}|${message.text}`,
      )
    })
    chat.onMessageDeleted(async (event) => {
      const where = located(key, platform, event.threadId)
      await intake(
        key,
        { kind: 'deleted', channel: where.channel, thread: where.thread, subthread: where.subthread, message: event.messageId },
        event.raw,
        `deleted:${where.subthread ?? where.thread}|${event.messageId}`,
      )
    })
    chat.onReaction(async (event: ReactionEvent) => {
      const where = located(key, platform, event.threadId)
      // Slack stamps a reaction event; WhatsApp sends each reaction as a message with its own ID.
      const raw = event.raw as { event_ts?: string; id?: string } | null
      const stamp = raw?.event_ts ?? raw?.id ?? String(Date.now())
      await intake(
        key,
        {
          kind: 'reaction',
          channel: where.channel,
          thread: where.thread,
          subthread: where.subthread,
          message: event.messageId,
          emoji: emojiName(event.emoji?.name ?? event.rawEmoji),
          added: event.added,
          author: platform.author(event.user, event.raw),
        },
        event.raw,
        `reaction:${where.subthread ?? where.thread}|${event.messageId}|${event.rawEmoji}|${event.user.userId}|${event.added}|${stamp}`,
      )
    })
    chats.set(key, chat)
  }

  /** Platform ingress: the adapter verifies the request; intake failures answer 500 so the platform retries. */
  async function handleWebhook(key: string, request: Request): Promise<Response> {
    const platform = entries[key]
    const chat = chats.get(key)
    if (!platform || !chat) throw notFound(`no sync entry named ${key}`)
    const body = platform.transport.intercept ? await request.clone().text() : null
    const tasks: Promise<unknown>[] = []
    const webhooks = chat.webhooks as Record<string, (r: Request, o: { waitUntil: (t: Promise<unknown>) => void }) => Promise<Response>>
    const response = await webhooks[platform.adapter.name]!(request, { waitUntil: (task) => void tasks.push(task) })
    const results = await Promise.allSettled(tasks)
    const failed = results.find((result) => result.status === 'rejected')
    if (failed) {
      console.error('[vboard] intake failed', (failed as PromiseRejectedResult).reason)
      return new Response('intake failed', { status: 500 })
    }
    if (response.ok && platform.transport.intercept && body !== null) {
      for (const draft of platform.transport.intercept(key, request.headers, body))
        await intake(key, draft.event, draft.raw, draft.dedupe)
    }
    return response
  }

  // --- inbound: inbox → board -------------------------------------------------------

  const externalIdentity = (author: { id: string; handle: string; name: string; avatar: string | null }): Identity => {
    const principal: Principal = { id: author.id, kind: 'external', handle: author.handle, can: 'all', expiresAt: null }
    return {
      principal,
      author: { actor: author.id, principal: author.id, profile: null, session: null },
      actor: { id: author.id, kind: 'external', handle: author.handle, name: author.name, avatar: author.avatar },
    }
  }

  /**
   * A platform message's files, onto the board: each is fetched through its
   * adapter (Chat SDK's `rehydrateAttachment`, so any platform that has it works)
   * and stored. A file that can't come over (too big, no blob store, the
   * platform refused) becomes a line in the text; a failed fetch retries the
   * message a few times first.
   */
  async function importFiles(platform: SyncPlatform, files: ExternalFile[], attempt: number) {
    const attachments: Attachment[] = []
    const notes: string[] = []
    const blob = options.blob
    for (const file of files.slice(0, ATTACHMENTS_PER_MESSAGE_MAX)) {
      if (!blob) {
        notes.push(fileNote(file, 'this board has no blob store'))
        continue
      }
      if (file.size !== undefined && file.size > ATTACHMENT_BYTES_MAX) {
        notes.push(fileNote(file, `over ${ATTACHMENT_BYTES_MAX / 1024 / 1024} MB`))
        continue
      }
      const fetchData = platform.adapter.rehydrateAttachment?.({ ...file }).fetchData
      if (!fetchData) {
        notes.push(fileNote(file, `${platform.platform} can't hand it over`))
        continue
      }
      let data: Uint8Array
      try {
        const fetched = await fetchData()
        data = fetched instanceof ArrayBuffer ? new Uint8Array(fetched) : new Uint8Array(fetched.buffer, fetched.byteOffset, fetched.byteLength)
      } catch (error) {
        if (attempt < FILE_ATTEMPTS) throw error
        console.warn(`[vboard] couldn't fetch ${file.name ?? 'a file'} from ${platform.platform}:`, describe(error))
        notes.push(fileNote(file, `${platform.platform} wouldn't hand it over`))
        continue
      }
      if (data.byteLength > ATTACHMENT_BYTES_MAX) {
        notes.push(fileNote(file, `over ${ATTACHMENT_BYTES_MAX / 1024 / 1024} MB`))
        continue
      }
      if (data.byteLength === 0) {
        notes.push(fileNote(file, 'it was empty'))
        continue
      }
      const name = file.name ?? `${file.type}`
      attachments.push(await writeUpload(blob, { data, name, type: file.mimeType || typeOf(name) }))
    }
    for (const file of files.slice(ATTACHMENTS_PER_MESSAGE_MAX))
      notes.push(fileNote(file, `a message carries at most ${ATTACHMENTS_PER_MESSAGE_MAX}`))
    return { attachments, notes }
  }

  async function inbound(trigger: InboxEvent, attempt = 1) {
    const { session, clientAs } = bound()
    const { sync: key, event, raw } = trigger.payload
    const platform = platformOf(key)
    const mapping = (await mappings(key)).get(event.channel)
    const { state: sync } = await session.state(syncReducer)
    if (event.kind === 'message') {
      const copied = sync.byExternalMessage[externalMessageKey(event.subthread ?? event.thread, event.message)]
      if (copied !== undefined) {
        const { state: messages } = await session.state(messagesReducer)
        const origin = messages.byId[copied]?.origin
        if (!origin || origin.message !== event.message || (origin.subthread ?? origin.thread) !== (event.subthread ?? event.thread)) return
      }
    }
    const linked = sync.byExternalThread[event.thread]
    const author = 'author' in event ? event.author : { id: `${platform.platform}:system`, handle: platform.platform, name: platform.platform, avatar: null }
    const board = clientAs(externalIdentity(author), trigger.id)
    let applied: Promise<SyncResult> | undefined
    let active = true
    const context: SyncContext = {
      key, event, raw, board,
      apply(channel, overrides = {}) {
        if (!active) throw badRequest('the sync callback has finished')
        if (applied) throw badRequest('an event can only be imported once per callback')
        applied = applyIncoming(trigger, attempt, ChannelPath.parse(channel), SyncOverrides.parse(overrides))
        return applied
      },
      client<E extends ProviderEvent>(publicEvent: E) {
        function sync(id: number, target: string): ReturnType<BoardClient['sync']>
        function sync(channel: string, event: E, overrides?: SyncOverrides): Promise<SyncResult>
        async function sync(first: string | number, second: string | E, overrides?: SyncOverrides) {
          if (!active) throw badRequest('the sync callback has finished')
          if (typeof first === 'number' && typeof second === 'string') return board.sync(first, second)
          if (typeof first !== 'string' || second !== publicEvent) throw badRequest('sync only accepts the current verified event')
          return platform.sync(context, first, publicEvent, overrides)
        }
        return { ...board, sync }
      },
    }
    try {
      if (mapping?.run) {
        await mapping.run(context)
        return
      }
      const channel = mapping?.channel ?? (linked ? sync.threads[linked]?.channel : undefined)
      if (channel) await platform.sync(context, channel, immutable(platform.event(context)))
    } finally {
      active = false
    }
  }

  async function applyIncoming(trigger: InboxEvent, attempt: number, channel: string, overrides: SyncOverrides): Promise<SyncResult> {
    const { writes, session } = bound()
    const { sync: key, event } = trigger.payload
    const platform = platformOf(key)
    const { state: sync } = await session.state(syncReducer)
    const threadKey = sync.byExternalThread[event.thread]
    const rootId = threadKey ? sync.threads[threadKey]?.root : undefined
    const writeId = (n: number) => idempotentId('vboard-inbound', trigger.id, String(n))
    const result = (message: { id: number; re: number | null }): SyncResult => ({ root: message.re ?? message.id, message: message.id })
    const labels = (defaults: Record<string, string> = {}) => {
      const merged = { ...defaults, ...overrides.labels }
      for (const key of overrides.unset ?? []) delete merged[key]
      return merged
    }
    const rootDraft = (draft: SyncRoot) => {
      if (!overrides.root) return draft
      const patch = overrides.root(immutable(structuredClone(draft)))
      if (patch && typeof patch === 'object' && 'then' in patch) throw badRequest('root overrides must be synchronous')
      const checked = SyncOverrides.pick({ text: true, labels: true }).parse(patch)
      return { ...draft, text: checked.text ?? draft.text, labels: { ...draft.labels, ...checked.labels } }
    }
    const setExtraLabels = async (identity: Identity, id: number) => {
      if (!overrides.labels && !overrides.unset) return
      const { state: messages } = await session.state(messagesReducer)
      const root = messages.byId[id]
      const set = Object.fromEntries(Object.entries(overrides.labels ?? {}).filter(([key, value]) => root?.labels[key] !== value))
      const unset = (overrides.unset ?? []).filter((key) => root?.labels[key] !== undefined)
      if (Object.keys(set).length || unset.length) await writeLabels(writes, { identity, id, set, unset })
    }

    switch (event.kind) {
      case 'message': {
        const existing = sync.byExternalMessage[externalMessageKey(event.subthread ?? event.thread, event.message)]
        if (existing !== undefined) return { root: rootId ?? existing, message: existing }
        const identity = externalIdentity(event.author)
        const { attachments, notes } = event.files?.length ? await importFiles(platform, event.files, attempt) : { attachments: [], notes: [] }
        const base = {
          identity,
          text: clampText(withNotes(overrides.text ?? event.text, notes), attachments.length > 0),
          ...(attachments.length ? { attachments } : {}),
          origin: { channel: event.channel, thread: event.thread, subthread: event.subthread, message: event.message, context: event.context },
          from: key,
          lenientMentions: true,
          id: await writeId(0),
        }
        if (rootId !== undefined) {
          await setExtraLabels(identity, rootId)
          return result(await writePost(writes, { ...base, re: rootId }))
        }
        if (!platform.transport.fetchRoot) {
          const draft = rootDraft({ text: event.text, labels: {}, author: event.author, raw: trigger.payload.raw })
          return result(await writePost(writes, { ...base, channel, text: clampText(withNotes(overrides.text ?? draft.text, notes), attachments.length > 0), labels: labels(draft.labels) }))
        }
        const fetched = await platform.transport.fetchRoot(event.thread.slice(key.length + 1))
        const draft = rootDraft({ ...fetched, raw: fetched.raw ?? null })
        const root = await writePost(writes, {
          identity: externalIdentity(fetched.author), channel,
          text: clampText(draft.text), labels: labels(draft.labels),
          origin: { channel: event.channel, thread: event.thread, subthread: null, message: `root:${trigger.id}`, context: null },
          from: key, lenientMentions: true, id: await writeId(1),
        })
        return result(await writePost(writes, { ...base, re: root.id }))
      }
      case 'edited':
      case 'deleted':
      case 'reaction': {
        const id = sync.byExternalMessage[externalMessageKey(event.subthread ?? event.thread, event.message)]
        if (id === undefined) return { root: rootId ?? null, message: null }
        const author = 'author' in event ? event.author : { id: `${platform.platform}:system`, handle: platform.platform, name: platform.platform, avatar: null }
        const identity = externalIdentity(author)
        if (rootId !== undefined) await setExtraLabels(identity, rootId)
        if (event.kind === 'deleted') await writeDelete(writes, { identity, id, from: key, asAuthor: false })
        else if (event.kind === 'edited') {
          const { state: messages } = await session.state(messagesReducer)
          const stored = messages.byId[id]
          const text = clampText(withNotes(overrides.text ?? event.text, stored ? notesIn(stored.text) : []), (stored?.attachments.length ?? 0) > 0)
          if (stored && stored.text !== text) await writeEdit(writes, { identity, id, text, from: key, asAuthor: false })
        } else {
          if (platform.singleReaction) {
            const { state: messages } = await session.state(messagesReducer)
            const emoji = canonicalEmoji(event.emoji)
            for (const [held, actors] of Object.entries(messages.byId[id]?.reactions ?? {}))
              if (actors.includes(identity.actor.id) && !(event.added && held === emoji))
                await writeReaction(writes, { identity, id, emoji: held, remove: true, from: key })
          }
          if (!platform.singleReaction || event.added) await writeReaction(writes, { identity, id, emoji: event.emoji, remove: !event.added, from: key })
        }
        return { root: rootId ?? null, message: id }
      }
      case 'lifecycle': {
        const identity = externalIdentity(event.author)
        if (rootId !== undefined) {
          const { state: messages } = await session.state(messagesReducer)
          const root = messages.byId[rootId]
          const desired = labels(event.labels)
          const owned = (key: string) => event.owns?.some((prefix) => key.startsWith(prefix)) ?? false
          const set = Object.fromEntries(Object.entries(desired).filter(([key, value]) => root?.labels[key] !== value))
          const unset = Object.keys(root?.labels ?? {}).filter((key) => !(key in desired) && (event.unset.includes(key) || overrides.unset?.includes(key) || owned(key)))
          if (root && !root.deleted && (Object.keys(set).length || unset.length)) await writeLabels(writes, { identity, id: rootId, set, unset })
          if (event.reply) return result(await writePost(writes, { identity, re: rootId, text: clampText(overrides.text ?? event.reply!), from: key, lenientMentions: true, id: await writeId(1) }))
          return { root: rootId, message: null }
        }
        if (!event.createRoot) return { root: null, message: null }
        const draft = rootDraft({ text: event.url ? `${event.title}\n${event.url}` : event.title, labels: event.labels, author: event.author, raw: trigger.payload.raw })
        const root = await writePost(writes, {
          identity, channel, text: clampText(overrides.text ?? draft.text), labels: labels(draft.labels),
          origin: { channel: event.channel, thread: event.thread, subthread: null, message: `lifecycle:${trigger.id}`, context: null },
          from: key, lenientMentions: true, id: await writeId(0),
        })
        if (event.reply) await writePost(writes, { identity, re: root.id, text: clampText(event.reply), from: key, lenientMentions: true, id: await writeId(1) })
        return result(root)
      }
    }
  }

  const inboxServer = createServer({
    contract: inboxContract,
    ...(options.store ? { store: options.store } : {}),
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
    handlers: {
      'external.received': {
        lane: ({ event }) => `thread:${event.payload.event.thread}`,
        handler: async (ctx) => {
          await inbound(ctx.event as InboxEvent, ctx.attempt)
        },
      },
    },
  })

  // --- outbound: board → platforms --------------------------------------------------

  const initialized = new Map<string, Promise<void>>()
  const chatFor = async (key: string) => {
    const chat = chats.get(key)
    if (!chat) throw badRequest(`no sync entry named ${key}`)
    let ready = initialized.get(key)
    if (!ready) {
      ready = chat.initialize()
      ready.catch(() => initialized.delete(key))
      initialized.set(key, ready)
    }
    await ready
    return chat
  }

  /** A board message as markdown for a platform, which converts it to its own format. */
  function render(key: string, target: string, message: Message, actors: ActorsState, quote?: Message): { markdown: string } {
    const actor = actors.byId[message.by.actor]
    let name = actor?.name ?? message.by.actor
    if (message.by.profile && actor?.handle.includes('/')) name = `${actor.name} via ${actor.handle.split('/')[0]}`
    if (message.from) name = `${name} (${platformOf(message.from).platform})`
    const quoted = quote
      ? `> ↪ ${actors.byId[quote.by.actor]?.name ?? 'someone'}${quote.origin?.context ? ` on ${quote.origin.context}` : ''}: ${quote.text.slice(0, 140).replace(/\n/g, ' ')}\n\n`
      : ''
    const body = platformOf(key).render(immutable({ message: structuredClone(message), author: actor ? { ...actor } : null, label: name, target }))
    if (typeof body !== 'string') throw badRequest('a provider renderer must return markdown')
    return { markdown: `${quoted}${body}` }
  }

  /** What a platform shows for files it didn't get: one line each, so a reader knows they're on the board. */
  const attachmentNotes = (message: Message) =>
    message.attachments.map((a) => `\n📎 ${a.name} (${fileSize(a.size)}, on the board: #${message.id})`).join('')

  /**
   * `render`, with a line per file where the files won't follow: on a platform
   * that takes no uploads, or one that refused them (`noted`).
   */
  const renderFor = (target: string, message: Message, actors: ActorsState, quote?: Message, noted = false) => {
    const key = keyOf(target)
    const { markdown } = render(key, target, message, actors, quote)
    const lines = message.attachments.length > 0 && (noted || !platformOf(key).transport.uploadFiles || !options.blob)
    return { markdown: lines ? `${markdown}\n${attachmentNotes(message)}` : markdown }
  }

  type Ctx<K extends keyof BoardEvents> = HandlerContext<BoardEvents, K>

  async function latest(ctx: Ctx<keyof BoardEvents>) {
    const [sync, messages, actors] = await Promise.all([
      ctx.session.state(syncReducer, { through: 'latest' }),
      ctx.session.state(messagesReducer, { through: 'latest' }),
      ctx.session.state(actorsReducer, { through: 'latest' }),
    ])
    return { sync: sync.state, messages: messages.state, actors: actors.state }
  }

  async function postReply(
    ctx: Ctx<keyof BoardEvents>,
    state: Awaited<ReturnType<typeof latest>>,
    message: Message,
    target: string,
    externalThread: string,
  ) {
    const replyTo = message.replyTo === null ? undefined : state.messages.byId[message.replyTo]
    const replyCopy = message.replyTo === null ? undefined : state.sync.copies[message.replyTo]?.[target]
    // A reply to a message in a platform sub-thread goes into that sub-thread; elsewhere it quotes it.
    const inSubthread = replyCopy !== undefined && replyCopy.thread !== externalThread
    const place = inSubthread ? replyCopy.thread : externalThread
    const chat = await chatFor(keyOf(target))
    let body = renderFor(target, message, state.actors, inSubthread ? undefined : replyTo)
    let files: string[] | null | undefined
    let sentId: string
    if (!body.markdown.trim() && message.attachments.length && options.blob && platformOf(keyOf(target)).transport.uploadFiles) {
      try {
        const sent = await uploadMessageFiles(message, target, place)
        sentId = sent.message
        files = sent.files
      } catch (error) {
        if (!platformOf(keyOf(target)).transport.refusesFiles?.(error)) throw error
        body = renderFor(target, message, state.actors, inSubthread ? undefined : replyTo, true)
        sentId = (await chat.thread(toChat(place)).post(body)).id
        files = null
      }
    } else {
      if (!body.markdown.trim()) throw badRequest('a renderer must return text unless the message has media')
      sentId = (await chat.thread(toChat(place)).post(body)).id
    }
    const external = { thread: place, message: sentId, ...(files !== undefined ? { files } : {}) }
    await recordDelivery(ctx, message, target, external)
    return external
  }

  async function recordDelivery(ctx: Ctx<keyof BoardEvents>, message: Message, target: string, copy: ExternalCopy) {
    await ctx.session.append(`delivery:${message.id}:${target}`,
      { type: 'message.synced' as const, id: `receipt:${message.id}:${target}`, payload: { id: message.id, thread: message.thread, target, external: { thread: copy.thread, message: copy.message } } },
      ...(copy.files !== undefined ? [{ type: 'message.files_synced' as const, id: `files:${message.id}:${target}`, payload: { id: message.id, thread: message.thread, target, files: copy.files } }] : []),
    )
  }

  /**
   * A message's files, into the thread its text went to, once. The text's
   * receipt comes first, so a retry sends only what's missing. If the platform
   * refuses files, the text gets a line for each; any other failure retries.
   */
  async function messageFiles(message: Message) {
    return Promise.all(message.attachments.map(async (a) => ({
      data: Buffer.from(await readAttachmentData(options.blob!, a.id)), filename: a.name, mimeType: a.type,
    })))
  }

  async function uploadMessageFiles(message: Message, target: string, thread: string) {
    return platformOf(keyOf(target)).transport.uploadFiles!(toChat(thread), await messageFiles(message))
  }

  async function deliverFiles(ctx: Ctx<keyof BoardEvents>, message: Message, target: string, copy: ExternalCopy, actors: ActorsState) {
    const platform = platformOf(keyOf(target))
    const blob = options.blob
    if (!platform.transport.uploadFiles || !blob || message.attachments.length === 0 || copy.files !== undefined) return
    let ids: string[] | null
    try {
      ids = (await uploadMessageFiles(message, target, copy.thread)).files
    } catch (error) {
      // Retried, and if it gives up, `message.sync_failed` says it was the files: the text is there.
      if (!platform.transport.refusesFiles?.(error)) throw Object.assign(new Error(`files: ${describe(error)}`), { cause: error, data: { error: `files: ${describe(error)}` } })
      console.warn(`[vboard] ${target} won't take #${message.id}'s files (${describe(error)}); noting them in its text`)
      ids = null
      const adapter = (await chatFor(keyOf(target))).getAdapter(platform.adapter.name)
      await adapter.editMessage(toChat(copy.thread), copy.message, renderFor(target, message, actors, undefined, true)).catch((edit: unknown) =>
        console.warn(`[vboard] couldn't note #${message.id}'s files on ${target}:`, describe(edit)),
      )
    }
    // If this append fails after an upload, the retry uploads again: rare, and a duplicate beats a loss.
    await ctx.session.append(`files:${message.id}:${target}`, {
      type: 'message.files_synced',
      payload: { id: message.id, thread: message.thread, target, files: ids },
    })
  }

  /**
   * A2 dead-letters a handler after 10 failures, and a dead letter stops its lane,
   * which is the thread's: nothing after it would sync. So a delivery retries a
   * few times, then records `message.sync_failed` and lets the thread move on.
   */
  const DELIVERY_ATTEMPTS = 5

  type Failure = { id: number; target: string; error: unknown }

  /** A platform error's code (`not_in_channel`) when it has one, else its message. */
  const describe = (error: unknown): string => {
    const code = (error as { data?: { error?: unknown } } | null)?.data?.error
    const text = typeof code === 'string' ? code : error instanceof Error ? error.message : String(error)
    return text.slice(0, 500) || 'unknown error'
  }

  async function settle(ctx: Ctx<'thread.synced' | 'message.posted'>, thread: string, failures: Failure[]) {
    if (failures.length === 0) return
    if (ctx.attempt < DELIVERY_ATTEMPTS) throw failures[0]!.error
    for (const { id, target, error } of failures) {
      console.error(`[vboard] gave up delivering #${id} to ${target}:`, describe(error))
      await ctx.session.append(`failed:${id}:${target}`, {
        type: 'message.sync_failed',
        payload: { id, thread, target, error: describe(error) },
      })
    }
  }

  async function deliverThread(ctx: Ctx<'thread.synced'>) {
    const { thread, target } = ctx.event.payload
    if ((ctx.event.payload.kind ?? (isThreadTarget(target) ? 'thread' : 'channel')) === 'thread') return // joining: only messages written after the join are delivered
    const state = await latest(ctx)
    const synced = state.sync.threads[thread]
    const root = synced ? state.messages.byId[synced.root] : undefined
    if (!synced || !root || root.deleted) return
    let externalThread = synced.external[target]
    if (!externalThread) {
      try {
        const chat = await chatFor(keyOf(target))
        const body = renderFor(target, root, state.actors)
        const mediaOnly = !body.markdown.trim() && root.attachments.length > 0 && options.blob && platformOf(keyOf(target)).transport.uploadFiles
        if (!body.markdown.trim() && !mediaOnly) throw badRequest('a renderer must return text unless the message has media')
        let uploaded: string[] | null | undefined
        const post = async () => {
          if (!mediaOnly) return chat.channel(toChat(target)).post(body)
          const files = await messageFiles(root)
          try {
            const sent = await chat.channel(toChat(target)).post({ ...body, files })
            uploaded = platformOf(keyOf(target)).transport.fileIds?.(sent.raw) ?? []
            return sent
          } catch (error) {
            if (!platformOf(keyOf(target)).transport.refusesFiles?.(error)) throw error
            uploaded = null
            return chat.channel(toChat(target)).post(renderFor(target, root, state.actors, undefined, true))
          }
        }
        const sent = await post()
        externalThread = toExternal(keyOf(target), sent.threadId)
        const external = { thread: externalThread, message: sent.id, ...(uploaded !== undefined ? { files: uploaded } : {}) }
        await recordDelivery(ctx, root, target, external)
        await deliverFiles(ctx, root, target, external, state.actors)
      } catch (error) {
        return settle(ctx, thread, [{ id: root.id, target, error }])
      }
    } else {
      const copy = state.sync.copies[root.id]?.[target]
      if (copy)
        try {
          await deliverFiles(ctx, root, target, copy, state.actors)
        } catch (error) {
          return settle(ctx, thread, [{ id: root.id, target, error }])
        }
    }
    const failures: Failure[] = []
    for (const replyId of state.messages.replies[root.id] ?? []) {
      const reply = state.messages.byId[replyId]
      if (!reply || reply.deleted || reply.noSync || cameFrom(reply, target)) continue
      try {
        const copy = state.sync.copies[replyId]?.[target] ?? (await postReply(ctx, state, reply, target, externalThread))
        await deliverFiles(ctx, reply, target, copy, state.actors)
      } catch (error) {
        failures.push({ id: replyId, target, error })
      }
    }
    await settle(ctx, thread, failures)
  }

  /** Never deliver a message back to the platform it came from. */
  const cameFrom = (message: Message, target: string) =>
    message.origin?.thread === target || (message.from !== null && keyOf(target) === message.from)

  async function deliverPost(ctx: Ctx<'message.posted'>) {
    const { payload } = ctx.event
    if (payload.re === null || payload.noSync) return
    const state = await latest(ctx)
    const synced = state.sync.threads[payload.thread]
    const message = state.messages.byId[ctx.event.index]
    if (!synced || !message || synced.targets.length === 0) return
    const failures: Failure[] = []
    for (const target of synced.targets) {
      const externalThread = synced.external[target]
      if (!externalThread) continue // the root isn't there yet; its thread.synced handler backfills
      if (cameFrom(message, target)) continue
      try {
        const copy = state.sync.copies[message.id]?.[target] ?? (await postReply(ctx, state, message, target, externalThread))
        await deliverFiles(ctx, message, target, copy, state.actors)
      } catch (error) {
        failures.push({ id: message.id, target, error })
      }
    }
    await settle(ctx, payload.thread, failures)
  }

  /** Edits, deletes, and reactions are best-effort: a platform that can't do one skips it. */
  async function deliverChange(
    ctx: Ctx<'message.edited' | 'message.deleted' | 'reaction.added' | 'reaction.removed'>,
  ) {
    const event = ctx.event
    const state = await latest(ctx)
    const copies = state.sync.copies[event.payload.id] ?? {}
    const message = state.messages.byId[event.payload.id]
    for (const [target, copy] of Object.entries(copies)) {
      if (event.payload.from !== null && keyOf(target) === event.payload.from) continue
      try {
        const adapter = (await chatFor(keyOf(target))).getAdapter(platformOf(keyOf(target)).adapter.name)
        const chatThread = toChat(copy.thread)
        if (event.type === 'message.edited' && message)
          await adapter.editMessage(chatThread, copy.message, renderFor(target, message, state.actors, undefined, copy.files === null))
        else if (event.type === 'message.deleted') {
          await adapter.deleteMessage(chatThread, copy.message)
          // The files went as a message of their own.
          if (copy.files?.length) await platformOf(keyOf(target)).transport.deleteFiles?.(copy.files)
        }
        else if (event.type === 'reaction.added') await adapter.addReaction(chatThread, copy.message, canonicalEmoji(event.payload.emoji))
        else if (event.type === 'reaction.removed') await adapter.removeReaction(chatThread, copy.message, canonicalEmoji(event.payload.emoji))
      } catch (error) {
        console.warn(`[vboard] skipped ${event.type} on ${target}:`, (error as Error).message)
      }
    }
  }

  /**
   * Shows typing in every platform thread a board thread is synced to. It's
   * ephemeral and best-effort: nothing goes in the log, and a platform that
   * fails is skipped. Answers the external threads that took it.
   */
  async function typing(thread: string): Promise<string[]> {
    const { session } = bound()
    const [{ state: sync }, { state: messages }] = await Promise.all([session.state(syncReducer), session.state(messagesReducer)])
    const synced = sync.threads[thread]
    if (!synced) return []
    const ids = [synced.root, ...(messages.replies[synced.root] ?? [])]
    const externals = [...new Set(Object.values(synced.external))]
    const done = await Promise.all(
      externals.map(async (external) => {
        const key = keyOf(external)
        try {
          const platform = platformOf(key)
          const chat = await chatFor(key)
          const chatThread = toChat(external)
          if (platform.transport.startTyping) {
            // The newest message that came from there, for platforms that mark it read (WhatsApp).
            let latest: string | null = null
            for (let i = ids.length - 1; i >= 0 && latest === null; i--) {
              const origin = messages.byId[ids[i]!]
              if (origin && !origin.deleted && origin.origin?.thread === external) latest = origin.origin.message
            }
            await platform.transport.startTyping(chatThread, latest)
          } else await chat.getAdapter(platform.adapter.name).startTyping(chatThread)
          return external
        } catch (error) {
          console.warn(`[vboard] skipped typing on ${external}:`, describe(error))
          return null
        }
      }),
    )
    return done.filter((external) => external !== null)
  }

  const lane = ({ event }: { event: { payload: unknown } }) => `thread:${(event.payload as { thread: string }).thread}`

  /** Board-contract handlers for outbound delivery, one lane per thread. */
  const outboundHandlers = {
    'thread.synced': { lane, handler: async (ctx: Ctx<'thread.synced'>) => void (await deliverThread(ctx)) },
    'message.posted': { lane, handler: async (ctx: Ctx<'message.posted'>) => void (await deliverPost(ctx)) },
    'message.edited': { lane, handler: async (ctx: Ctx<'message.edited'>) => void (await deliverChange(ctx)) },
    'message.deleted': { lane, handler: async (ctx: Ctx<'message.deleted'>) => void (await deliverChange(ctx)) },
    'reaction.added': { lane, handler: async (ctx: Ctx<'reaction.added'>) => void (await deliverChange(ctx)) },
    'reaction.removed': { lane, handler: async (ctx: Ctx<'reaction.removed'>) => void (await deliverChange(ctx)) },
  }

  async function readInbox(key: string, channel: string | undefined, limit: number) {
    platformOf(key)
    let channels: string[]
    try {
      channels = channel ? [`${key}:${await platformOf(key).resolveChannel(channel)}`] : [...(await mappings(key)).keys()]
    } catch (error) {
      throw badRequest(`can't resolve inbox channel: ${(error as Error).message}`)
    }
    const events = (
      await Promise.all(channels.map((c) => inboxServer.session(inboxSession(c)).history()))
    ).flat()
    return events
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, limit)
      .map((event) => ({
        id: event.id,
        channel: event.sessionId.replace(/^inbox:/, ''),
        createdAt: new Date(event.createdAt).toISOString(),
        ...(event.payload as object),
      }))
  }

  return {
    inboxServer,
    outboundHandlers,
    bind: (b: BoardBinding) => {
      binding = b
    },
    configTargets,
    normalizeTarget,
    handleWebhook,
    readInbox,
    typing,
    /** For tests: the Chat SDK instance behind an entry. */
    chat: (key: string) => chats.get(key),
  }
}

export type SyncEngine = ReturnType<typeof createSyncEngine>
