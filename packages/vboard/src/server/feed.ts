import type { z } from 'zod'
import type { Filters, MessageView, BoardEventView } from '../api/routes.ts'
import type { BoardEvent } from '../contract/contract.ts'
import {
  foldActors,
  foldMessages,
  iso,
  messagesReducer,
  type ActorsState,
  type Message,
  type MessagesState,
} from '../contract/reducers.ts'
import type { BoardSession } from './board.ts'

export type ParsedFilters = z.output<typeof Filters>

/** Bookkeeping events, shown only with `all`: who's who, and delivery receipts. */
const HIDDEN = new Set(['actor.seen', 'message.synced'])

export function view(message: Message, actors: ActorsState): MessageView {
  const author = actors.byId[message.by.actor]
  return {
    ...message,
    labels: { ...message.labels },
    reactions: Object.fromEntries(
      Object.entries(message.reactions).map(([emoji, ids]) => [emoji, [...ids]]),
    ),
    author: author ? { handle: author.handle, name: author.name, avatar: author.avatar } : null,
  }
}

const actorSet = (value: string, actors: ActorsState): Set<string> =>
  actors.byId[value] ? new Set([value]) : new Set(actors.byHandle[value.toLowerCase()] ?? [])

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
  const by = filters.by === undefined ? null : actorSet(filters.by, context.actors)
  const mentions =
    filters.mentions === undefined
      ? null
      : filters.mentions === 'me'
        ? new Set(context.me === null ? [] : [context.me])
        : actorSet(filters.mentions, context.actors)
  return (message) => {
    if (!message) return false
    if (channel !== undefined) {
      if (subtree !== null) {
        if (message.channel !== subtree && !message.channel.startsWith(`${subtree}/`)) return false
      } else if (message.channel !== channel) return false
    }
    if (filters.re !== undefined && message.id !== filters.re && message.re !== filters.re)
      return false
    if (by !== null && !by.has(message.by.actor)) return false
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

/** The message an event concerns, if any. */
export function concernedMessageId(event: BoardEvent): number | null {
  if (event.type === 'message.posted') return event.index
  if ('id' in event.payload) return event.payload.id
  return null
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
  return {
    index: event.index,
    type: event.type,
    createdAt: iso(event.createdAt),
    payload: event.payload,
    ...(after ? { message: view(after, actors) } : {}),
    ...(actor ? { actor: { id: actor.id, handle: actor.handle, name: actor.name, avatar: actor.avatar } } : {}),
  }
}

export type FeedItem = { index: number; view: BoardEventView | null }

/**
 * Folds events one at a time from a known state and decides what a subscriber
 * sees. A label or reaction change is delivered when its message matched the
 * filter before *or* after it, so subscribers see messages leave a view too.
 */
export class FeedProjection {
  private readonly messages: MessagesState
  readonly actors: ActorsState
  private readonly match: (message: Message | undefined) => boolean
  private readonly criteria: boolean
  private readonly all: boolean

  constructor(
    messages: MessagesState,
    actors: ActorsState,
    match: (message: Message | undefined) => boolean,
    criteria: boolean,
    all: boolean,
  ) {
    this.messages = messages
    this.actors = actors
    this.match = match
    this.criteria = criteria
    this.all = all
  }

  step(event: BoardEvent): FeedItem {
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
  after: number | undefined
  filters: ParsedFilters
  all: boolean
  me: string | null
  actors: ActorsState
}

/** The starting state and index: `after`, or the current head when omitted. */
async function start(options: FeedOptions) {
  const head = await options.session.state(messagesReducer)
  if (options.after === undefined || options.after >= head.index) return head
  return options.session.state(messagesReducer, { through: options.after })
}

function projection(options: FeedOptions, messages: MessagesState) {
  return new FeedProjection(
    messages,
    options.actors,
    compileFilter(options.filters, { me: options.me, actors: options.actors, messages }),
    hasCriteria(options.filters),
    options.all,
  )
}

/** Every event after the start, live, until the signal aborts. */
export async function* liveFeed(
  options: FeedOptions,
  signal: AbortSignal,
): AsyncGenerator<FeedItem> {
  const { state, index } = await start(options)
  const feed = projection(options, state)
  const iterator = options.session.stream({ startAfter: index })[Symbol.asyncIterator]()
  try {
    // The starting cursor, so a client that sees nothing yet can still resume exactly.
    yield { index, view: null }
    while (true) {
      const next = await nextOrAbort(iterator, signal)
      if (next === null || next.done) return
      yield feed.step(next.value as BoardEvent)
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
  const { state, index } = await start(options)
  const feed = projection(options, state)
  const events: BoardEventView[] = []
  let cursor = index
  const backlog = await options.session.history({ gte: index + 1, lte: index + PAGE })
  for (const event of backlog) {
    const item = feed.step(event as BoardEvent)
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
      const item = feed.step(next.value as BoardEvent)
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
