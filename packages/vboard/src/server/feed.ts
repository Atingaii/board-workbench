import type { z } from 'zod'
import type { ActorView, Filters, MessageView, BoardEventView, PersonView } from '../api/routes.ts'
import type { BoardEvent } from '../contract/contract.ts'
import {
  channelsReducer,
  foldActors,
  foldMessages,
  iso,
  linkedTo,
  personOf,
  type ActorsState,
  type Message,
  type MessagesState,
} from '../contract/reducers.ts'
import { concernedMessageId } from '../store/project.ts'
import type { MessageFilter } from '../store/types.ts'
import type { BoardSession } from './board.ts'
import type { BoardReads } from './reads.ts'

export { concernedMessageId }

export type ParsedFilters = z.output<typeof Filters>

/** Bookkeeping events, shown only with `all`: who's who, and delivery receipts. */
const HIDDEN = new Set(['actor.seen', 'message.synced', 'message.files_synced'])

/** The person a linked platform actor is, as views show it. */
export function personView(actors: ActorsState, actor: string): PersonView | undefined {
  const link = actors.links[actor]
  const person = link ? actors.byId[link.to] : undefined
  return link ? { id: link.to, handle: person?.handle ?? link.to, name: person?.name ?? link.to, avatar: person?.avatar ?? null } : undefined
}

export function actorView(actors: ActorsState, id: string): ActorView | null {
  const author = actors.byId[id]
  if (!author) return null
  const person = personView(actors, id)
  return { kind: author.kind, handle: author.handle, name: author.name, avatar: author.avatar, ...(person ? { person } : {}) }
}

export function view(message: Message, actors: ActorsState): MessageView {
  return {
    ...message,
    labels: { ...message.labels },
    reactions: Object.fromEntries(
      Object.entries(message.reactions).map(([emoji, ids]) => [emoji, [...ids]]),
    ),
    author: actorView(actors, message.by.actor),
  }
}

/** Whether accounts are linked to `id`: then it's a person, even one who never wrote on the board. */
const hasLinks = (actors: ActorsState, id: string) => Object.values(actors.links).some((link) => link.to === id)

const actorSet = (value: string, actors: ActorsState): Set<string> =>
  actors.byId[value] || actors.links[value] || hasLinks(actors, value) ? new Set([value]) : new Set(actors.byHandle[value.toLowerCase()] ?? [])

/**
 * Who a `--by` or `--mentions` value covers. A person (`julian`, or one of their
 * linked accounts, `@julian` on Slack) is everyone they are: their own actor,
 * their agents (`julian/claude`), and every account linked to them. An agent
 * or an unlinked platform actor is just itself.
 */
export function whoIs(value: string, actors: ActorsState): { actors: Set<string>; principals: Set<string> } {
  const ids = actorSet(value, actors)
  const out = new Set(ids)
  const principals = new Set<string>()
  for (const id of ids) {
    const kind = actors.byId[id]?.kind
    const person = actors.links[id] ? personOf(actors, id) : kind === 'person' || hasLinks(actors, id) ? id : null
    if (person === null) continue
    principals.add(person)
    out.add(person)
    for (const linked of linkedTo(actors, person)) out.add(linked)
  }
  return { actors: out, principals }
}

/** Whether `author` is one of `who`: its actor, or an agent of one of its people. */
const covers = (who: { actors: Set<string>; principals: Set<string> }, actor: string, principal?: string) =>
  who.actors.has(actor) || (principal !== undefined && who.principals.has(principal))

export const hasCriteria = (filters: ParsedFilters) =>
  filters.channel !== undefined ||
  filters.re !== undefined ||
  filters.by !== undefined ||
  filters.mentions !== undefined ||
  filters.from !== undefined ||
  filters.text !== undefined ||
  (filters.label?.length ?? 0) > 0

type LabelFilter = readonly [string, readonly string[] | null]

const hasLabel = (labels: Record<string, string>, [key, values]: LabelFilter) =>
  key in labels && (values === null || values.includes(labels[key]!))

/**
 * Compiles filters once; handles resolve against the actors known at that
 * moment. A label matches on the message or its thread's root, where sync puts
 * labels, so `pr=…` means the PR's whole conversation. `messages` is the live
 * state for that lookup.
 */
export function compileFilter(
  filters: ParsedFilters,
  context: { me: string | null; actors: ActorsState; messages?: MessagesState },
): (message: Message | undefined) => boolean {
  const text = filters.text?.toLowerCase()
  const labels = filters.label ?? []
  const channel = filters.channel
  const subtree = channel?.endsWith('/') ? channel.slice(0, -1) : null
  const by = filters.by === undefined ? null : whoIs(filters.by, context.actors)
  // `me` is the caller's own actor, and the platform accounts linked to it.
  const mentions =
    filters.mentions === undefined
      ? null
      : filters.mentions === 'me'
        ? new Set(context.me === null ? [] : [context.me, ...linkedTo(context.actors, context.me)])
        : whoIs(filters.mentions, context.actors).actors
  return (message) => {
    if (!message) return false
    if (channel !== undefined) {
      if (subtree !== null) {
        if (message.channel !== subtree && !message.channel.startsWith(`${subtree}/`)) return false
      } else if (message.channel !== channel) return false
    }
    if (filters.re !== undefined && message.id !== filters.re && message.re !== filters.re)
      return false
    if (by !== null && !covers(by, message.by.actor, message.by.principal)) return false
    if (mentions !== null && !message.mentions.some((id) => mentions.has(id))) return false
    if (filters.from !== undefined && (message.from ?? 'board') !== filters.from) return false
    if (text !== undefined && !message.text.toLowerCase().includes(text)) return false
    if (labels.length > 0) {
      const root = message.re === null ? undefined : context.messages?.byId[message.re]
      for (const label of labels)
        if (!hasLabel(message.labels, label) && !(root && hasLabel(root.labels, label))) return false
    }
    return true
  }
}

/** The filters as the tables take them: handles resolved to who they cover, `me` to the caller. */
export function toMessageFilter(filters: ParsedFilters, context: { me: string | null; actors: ActorsState }): MessageFilter {
  const out: MessageFilter = {}
  const channel = filters.channel
  if (channel !== undefined)
    out.channel = channel.endsWith('/') ? { path: channel.slice(0, -1), subtree: true } : { path: channel, subtree: false }
  if (filters.re !== undefined) out.re = filters.re
  if (filters.by !== undefined) {
    const who = whoIs(filters.by, context.actors)
    out.by = { actors: [...who.actors], principals: [...who.principals] }
  }
  if (filters.mentions !== undefined)
    out.mentions =
      filters.mentions === 'me'
        ? context.me === null ? [] : [context.me, ...linkedTo(context.actors, context.me)]
        : [...whoIs(filters.mentions, context.actors).actors]
  if (filters.from !== undefined) out.from = filters.from
  if (filters.text !== undefined) out.text = filters.text.toLowerCase()
  if (filters.label?.length) out.labels = filters.label.map(([key, values]) => ({ key, values }))
  return out
}

/**
 * Loads into `messages`, as they were just before `event`, the message it
 * concerns and that message's root: what folding it and matching filters need.
 * `loaded` remembers what was asked for already, found or not.
 */
async function loadInto(
  reads: BoardReads,
  messages: MessagesState,
  loaded: Set<number>,
  event: BoardEvent,
  signal?: AbortSignal,
): Promise<void> {
  const id = concernedMessageId(event)
  if (id === null) return
  const through = event.index - 1
  const load = async (ids: number[]) => {
    const wanted = ids.filter((want) => !loaded.has(want))
    if (wanted.length === 0) return
    const found = await reads.messagesAt(wanted, through, signal)
    for (const want of wanted) {
      loaded.add(want)
      const message = found.get(want)
      if (message) messages.byId[want] = message
    }
  }
  // A post is new: the fold makes it. The rest concern a message that was already there.
  if (event.type === 'message.posted') loaded.add(id)
  else await load([id])
  const re = event.type === 'message.posted' ? event.payload.re : (messages.byId[id]?.re ?? null)
  if (re !== null) await load([re])
}

/** The message `event` concerns and its root, as they were just before it. */
export async function loadBefore(reads: BoardReads, event: BoardEvent, signal?: AbortSignal): Promise<MessagesState> {
  const messages: MessagesState = { byId: {}, replies: {} }
  await loadInto(reads, messages, new Set(), event, signal)
  return messages
}

/** Folds one event into `messages` and `actors`, and returns the message it concerns before and after. */
export function foldEvent(messages: MessagesState, actors: ActorsState, event: BoardEvent) {
  const id = concernedMessageId(event)
  const before = id === null ? undefined : structuredClone(messages.byId[id])
  foldMessages(messages, event)
  foldActors(actors, event)
  const after = id === null ? undefined : messages.byId[id]
  return { id, before, after }
}

/** An event as subscribers receive it, with its message as it is afterwards. */
export function eventView(event: BoardEvent, after: Message | undefined, actors: ActorsState): BoardEventView {
  const by = (event.payload as { by?: { actor?: string } }).by?.actor
  const actor = by ? actors.byId[by] : undefined
  // `type` and `payload` come from the same event, so they still match; TypeScript
  // can't follow that through a union, and this is the one place views are made.
  return {
    index: event.index,
    type: event.type,
    createdAt: iso(event.createdAt),
    payload: event.payload,
    ...(after ? { message: view(after, actors) } : {}),
    ...(actor ? { actor: { id: actor.id, ...actorView(actors, actor.id)! } } : {}),
  } as BoardEventView
}

export type FeedItem = { index: number; view: BoardEventView | null }

/**
 * Folds events one at a time and decides what a subscriber sees. It holds only
 * the messages events have touched, each loaded from the tables as it was just
 * before the first event that touched it. A label or reaction change is
 * delivered when its message matched the filter before *or* after it, so
 * subscribers see messages leave a view too.
 */
export class FeedProjection {
  private readonly messages: MessagesState = { byId: {}, replies: {} }
  private readonly loaded = new Set<number>()
  private readonly reads: BoardReads
  readonly actors: ActorsState
  private readonly match: (message: Message | undefined) => boolean
  private readonly criteria: boolean
  private readonly all: boolean

  constructor(options: FeedOptions) {
    this.reads = options.reads
    this.actors = options.actors
    this.match = compileFilter(options.filters, { me: options.me, actors: options.actors, messages: this.messages })
    this.criteria = hasCriteria(options.filters)
    this.all = options.all
  }

  /** Loads what `events` touch, all as of `index`, in two queries rather than two per event. */
  async preload(events: readonly BoardEvent[], index: number): Promise<void> {
    const ids = new Set<number>()
    for (const event of events) {
      const id = concernedMessageId(event)
      if (id === null) continue
      if (event.type !== 'message.posted') ids.add(id)
      else if (event.payload.re !== null) ids.add(event.payload.re)
    }
    const load = async (wanted: number[]) => {
      if (wanted.length === 0) return
      const found = await this.reads.messagesAt(wanted, index)
      for (const id of wanted) {
        this.loaded.add(id)
        const message = found.get(id)
        if (message) this.messages.byId[id] = message
      }
    }
    await load([...ids].filter((id) => !this.loaded.has(id) && id <= index))
    const roots = Object.values(this.messages.byId).flatMap((message) => (message.re === null ? [] : [message.re]))
    await load([...new Set(roots)].filter((id) => !this.loaded.has(id)))
  }

  async step(event: BoardEvent, signal?: AbortSignal): Promise<FeedItem> {
    await loadInto(this.reads, this.messages, this.loaded, event, signal)
    const { id, before, after } = foldEvent(this.messages, this.actors, event)
    const hidden = HIDDEN.has(event.type) && !this.all
    const visible = !hidden && (this.criteria ? this.match(before) || this.match(after) : id !== null || this.all)
    if (!visible) return { index: event.index, view: null }
    return { index: event.index, view: eventView(event, after, this.actors) }
  }
}

/** Resolves when the iterator yields, or with null once the signal aborts. */
function nextOrAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T> | null> {
  if (signal.aborted) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(null)
    signal.addEventListener('abort', onAbort, { once: true })
    iterator.next().then(
      (result) => {
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export type FeedOptions = {
  session: BoardSession
  reads: BoardReads
  after: number | undefined
  filters: ParsedFilters
  all: boolean
  me: string | null
  actors: ActorsState
}

/** Where a feed starts: `after`, or the head when it's omitted or past it. */
async function start(options: FeedOptions): Promise<number> {
  const { index: head } = await options.session.state(channelsReducer)
  return options.after === undefined || options.after >= head ? head : options.after
}

/** Every event after the start, live, until the signal aborts. */
export async function* liveFeed(
  options: FeedOptions,
  signal: AbortSignal,
): AsyncGenerator<FeedItem> {
  const index = await start(options)
  const feed = new FeedProjection(options)
  const iterator = options.session.stream({ startAfter: index })[Symbol.asyncIterator]()
  try {
    // The starting cursor, so a client that sees nothing yet can still resume exactly.
    yield { index, view: null }
    while (true) {
      const next = await nextOrAbort(iterator, signal)
      if (next === null || next.done) return
      yield await feed.step(next.value as BoardEvent, signal)
    }
  } finally {
    void iterator.return?.()
  }
}

const PAGE = 200

/**
 * One long-poll: matching events already in the log return at once; otherwise
 * it waits up to `waitMs` for the first new match. The cursor is the last
 * event examined, matched or not, so the next poll never rescans.
 */
export async function pollFeed(
  options: FeedOptions,
  waitMs: number,
  signal: AbortSignal,
): Promise<{ events: BoardEventView[]; cursor: number }> {
  const index = await start(options)
  const feed = new FeedProjection(options)
  const events: BoardEventView[] = []
  let cursor = index
  const backlog = (await options.session.history({ gte: index + 1, lte: index + PAGE })) as BoardEvent[]
  await feed.preload(backlog, index)
  for (const event of backlog) {
    const item = await feed.step(event, signal)
    cursor = item.index
    if (item.view) events.push(item.view)
  }
  if (events.length > 0 || backlog.length === PAGE || waitMs <= 0) return { events, cursor }

  const timeout = AbortSignal.timeout(waitMs)
  const until = AbortSignal.any([signal, timeout])
  const iterator = options.session.stream({ startAfter: cursor })[Symbol.asyncIterator]()
  try {
    while (true) {
      const next = await nextOrAbort(iterator, until)
      if (next === null || next.done) return { events, cursor }
      const item = await feed.step(next.value as BoardEvent, until)
      cursor = item.index
      if (item.view) {
        events.push(item.view)
        return { events, cursor }
      }
    }
  } finally {
    void iterator.return?.()
  }
}
