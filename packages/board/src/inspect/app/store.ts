import type { ActorView, BoardEventView, ChannelView, Discovery, Me, MessageView, ThreadsPage } from '../../api/routes.ts'
import { canonicalEmoji } from '../../contract/emoji.ts'
import { actorKind } from '../../contract/schemas.ts'

// The board, as this page knows it. Pure functions over plain state: the page
// loads snapshots, folds the live stream in, and overlays your own writes until
// the board confirms them. No DOM here, so it's tested like the rest.

/** A change you made that the board hasn't confirmed yet. */
export type Op =
  | { kind: 'react'; emoji: string; remove: boolean }
  | { kind: 'edit'; text: string }
  | { kind: 'delete' }
  | { kind: 'label'; set: Record<string, string>; unset: string[] }

/** A post on its way: shown at once, replaced by the real message when the board answers. */
export type Pending = {
  key: string
  channel: string
  re: string | null
  text: string
  noSync: boolean
  labels: Record<string, string>
  /** Files going with it, shown while it's on its way. */
  files?: { name: string; size: number }[]
  createdAt: string
  error: string | null
}

/** A listed thread: how many replies it has and its latest, by ID, as the board listed it or the stream has moved it since. */
export type Row = { replies: number; last: string | null }

/**
 * A channel's threads as the board lists them, by latest activity: a row per thread, by its root's ID, and the
 * `older` of the last page read, where the next older page starts (null when the oldest is here).
 */
export type Listing = { rows: Record<string, Row>; older: string | null }

export type State = {
  me: Me | null
  discovery: Discovery | null
  channels: Record<string, ChannelView>
  /** Messages as the board last showed them, by ID. Of two views of one, the higher `version` wins. */
  messages: Record<string, MessageView>
  ops: Record<string, { id: string; op: Op }[]>
  pending: Pending[]
  actors: Record<string, ActorView>
  /** The stream's position: the last event's cursor, to resume from. */
  cursor: string | null
  live: 'connecting' | 'live' | 'reconnecting'
  /** Each opened channel's listing, or null on a board whose thread pages have no `older`: it loads by messages. */
  listings: Record<string, Listing | null>
}

export const initialState: State = {
  me: null,
  discovery: null,
  channels: {},
  messages: {},
  ops: {},
  pending: [],
  actors: {},
  cursor: null,
  live: 'connecting',
  listings: {},
}

/** Whether a message as the board shows it already reflects a change you made. */
export function confirms(message: MessageView, op: Op, me: string): boolean {
  switch (op.kind) {
    case 'react': {
      const reacted = (message.reactions[canonicalEmoji(op.emoji)] ?? []).includes(me)
      return op.remove ? !reacted : reacted || message.deleted
    }
    case 'edit':
      return message.text === op.text || message.deleted
    case 'delete':
      return message.deleted
    case 'label':
      return (
        message.deleted ||
        (Object.entries(op.set).every(([key, value]) => message.labels[key] === value) &&
          op.unset.every((key) => !(key in message.labels)))
      )
  }
}

/** A message with your unconfirmed changes applied. */
export function apply(message: MessageView, op: Op, me: string, now: string): MessageView {
  switch (op.kind) {
    case 'react': {
      const emoji = canonicalEmoji(op.emoji)
      const actors = (message.reactions[emoji] ?? []).filter((actor) => actor !== me)
      const reactions = { ...message.reactions, [emoji]: op.remove ? actors : [...actors, me] }
      if (reactions[emoji]!.length === 0) delete reactions[emoji]
      return { ...message, reactions }
    }
    case 'edit':
      return { ...message, text: op.text, editedAt: now }
    case 'delete':
      return { ...message, deleted: true, text: '', reactions: {} }
    case 'label': {
      const labels = { ...message.labels, ...op.set }
      for (const key of op.unset) delete labels[key]
      return { ...message, labels }
    }
  }
}

/** Takes in message views, keeping whichever of each is newer: an older view never replaces a newer one. */
export function merge(state: State, views: MessageView[]): State {
  let messages = state.messages
  let ops = state.ops
  for (const view of views) {
    if ((messages[view.id]?.version ?? -1) > view.version) continue
    if (messages === state.messages) messages = { ...messages }
    messages[view.id] = view
    const waiting = ops[view.id]
    if (waiting && state.me) {
      const left = waiting.filter(({ op }) => !confirms(view, op, state.me!.actor))
      if (left.length !== waiting.length) {
        ops = { ...ops }
        if (left.length > 0) ops[view.id] = left
        else delete ops[view.id]
      }
    }
  }
  return messages === state.messages && ops === state.ops ? state : { ...state, messages, ops }
}

/**
 * The post on its way that a message you wrote stands for. The stream can bring
 * the message before the board answers the post; whichever comes first replaces
 * it, so the two never show at once.
 */
function landed(state: State, message: MessageView): Pending | undefined {
  if (message.by.actor !== state.me?.actor) return undefined
  return state.pending.find(
    (post) => post.error === null && post.channel === message.channel && post.re === message.re && post.text === message.text,
  )
}

/** When a listed thread was last active: its latest reply, or its root. */
function activity(state: State, root: string, row: Row): Pick<MessageView, 'createdAt' | 'id'> {
  return (row.last === null ? undefined : state.messages[row.last]) ?? state.messages[root] ?? { createdAt: '', id: root }
}

/**
 * Takes in a page of a channel's threads: one row per thread, the newer where a thread is listed already. The first
 * page read and every older one set where the next older page starts; the first page read again leaves it.
 */
export function mergeThreads(state: State, channel: string, page: ThreadsPage, which: 'first' | 'older'): State {
  const next = merge(state, page.threads.flatMap((t) => (t.last ? [t.message, t.last] : [t.message])))
  const listing = next.listings[channel]
  const rows = { ...listing?.rows }
  for (const { message, replies, last } of page.threads) {
    const row = { replies, last: last?.id ?? null }
    const kept = rows[message.id]
    if (!kept || byWritten(activity(next, message.id, kept), activity(next, message.id, row)) <= 0) rows[message.id] = row
  }
  const older = which === 'first' && listing ? listing.older : (page.older ?? null)
  return { ...next, listings: { ...next.listings, [channel]: { rows, older } } }
}

/** A channel on a board whose thread pages have no `older`: it loads by messages. */
export const unpaged = (state: State, channel: string): State => ({ ...state, listings: { ...state.listings, [channel]: null } })

/** A post in a listed channel: a new thread gets a row, and a reply moves its thread's on, once. */
function listed(state: State, message: MessageView): State {
  const listing = state.listings[message.channel]
  if (!listing) return state
  const root = message.re ?? message.id
  const row = listing.rows[root]
  let next: Row
  if (message.re === null) {
    if (row) return state
    next = { replies: 0, last: null }
  } else {
    if (!row || byWritten(activity(state, root, row), message) >= 0) return state
    next = { replies: row.replies + 1, last: message.id }
  }
  return { ...state, listings: { ...state.listings, [message.channel]: { ...listing, rows: { ...listing.rows, [root]: next } } } }
}

/** The channel of a live reply whose thread its listing doesn't have, so its first page is read again; else null. */
export function unlisted(state: State, event: BoardEventView): string | null {
  const message = event.message
  if (event.type !== 'message.posted' || !message || message.re === null) return null
  const listing = state.listings[message.channel]
  return listing && !listing.rows[message.re] ? message.channel : null
}

/** Folds one live event in: the message it concerns, channel counts, listed threads, and actor details. */
export function applyEvent(state: State, event: BoardEventView): State {
  let next = event.message ? merge(state, [event.message]) : state
  if (event.type === 'message.posted' && event.message) {
    next = listed(next, event.message)
    const post = landed(next, event.message)
    if (post) next = { ...next, pending: next.pending.filter((p) => p !== post) }
    const { channel, re } = event.message
    const known = next.channels[channel]
    // A board that counts nothing in its channels (Vercel's API) gets no counts made up here,
    // for a channel a post shows first either.
    const uncounted = known ? known.lastIndex === undefined : Object.values(next.channels).some((c) => c.lastIndex === undefined)
    if (uncounted) {
      if (!known) next = { ...next, channels: { ...next.channels, [channel]: { path: channel } } }
    }
    // A new message's version is where it landed, as a channel's `lastIndex` is.
    else if (!known || (known.lastIndex ?? 0) < event.message.version)
      next = {
        ...next,
        channels: {
          ...next.channels,
          [channel]: {
            path: channel,
            lastIndex: event.message.version,
            messages: (known?.messages ?? 0) + 1,
            threads: (known?.threads ?? 0) + (re === null ? 1 : 0),
          },
        },
      }
  }
  // One made before anything posted to it lists at once, empty; a post that beat it here already did.
  if (event.type === 'channel.created' && !next.channels[event.payload.channel]) {
    const { channel } = event.payload
    next = { ...next, channels: { ...next.channels, [channel]: { path: channel, lastIndex: 0, messages: 0, threads: 0 } } }
  }
  if (event.type === 'actor.seen') {
    const { actor, kind, handle, name, avatar, via, platform } = event.payload
    next = { ...next, actors: { ...next.actors, [actor]: { kind: actorKind(kind), handle, name, avatar, ...(via ? { via } : {}), ...(platform ? { platform } : {}) } } }
  }
  // The stream comes in order, so the last event's cursor is where to resume.
  return { ...next, cursor: event.cursor }
}

export function addOp(state: State, message: string, id: string, op: Op): State {
  return { ...state, ops: { ...state.ops, [message]: [...(state.ops[message] ?? []), { id, op }] } }
}

export function dropOp(state: State, message: string, id: string): State {
  const left = (state.ops[message] ?? []).filter((entry) => entry.id !== id)
  const ops = { ...state.ops }
  if (left.length > 0) ops[message] = left
  else delete ops[message]
  return { ...state, ops }
}

/** A message as this page shows it: the board's view, your pending changes, and fresh author details. */
export function shown(state: State, id: string, now = new Date().toISOString()): MessageView | undefined {
  const message = state.messages[id]
  if (!message) return undefined
  let out = message
  for (const { op } of state.ops[id] ?? []) out = apply(out, op, state.me?.actor ?? '', now)
  const actor = state.actors[message.by.actor]
  // Who it acts through, and its platform, stay as the board showed them when what it records now doesn't say.
  const via = actor?.via ?? out.author?.via
  const platform = actor?.platform ?? out.author?.platform
  return actor ? { ...out, author: { ...actor, ...(via ? { via } : {}), ...(platform ? { platform } : {}) } } : out
}

export type Thread = { root: MessageView; replies: MessageView[]; pending: Pending[] }

/** A root's replies at a glance: how many, the latest, and the last three people who wrote one. */
export type ReplySummary = { count: number; last: MessageView | null; faces: MessageView[] }

/** A thread in a channel, with its replies summarized. */
export type ChannelThread = Thread & { summary: ReplySummary }

function summarize(replies: MessageView[], count = replies.length, last: MessageView | null = replies.at(-1) ?? null): ReplySummary {
  const newest = last && replies.length > 0 && byWritten(replies.at(-1)!, last) > 0 ? replies.at(-1)! : last
  const faces = [...new Map([...replies, ...(newest && !replies.includes(newest) ? [newest] : [])].map((r) => [r.by.actor, r])).values()].slice(-3)
  return { count: Math.max(count, replies.filter((r) => !r.deleted).length), last: newest, faces }
}

/**
 * Messages in the order they were written: by when, and between two in the same millisecond, by
 * ID, digits compared as numbers. IDs are the board's to choose, so this is only a tiebreak.
 */
export const byWritten = (a: Pick<MessageView, 'createdAt' | 'id'>, b: Pick<MessageView, 'createdAt' | 'id'>) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id, undefined, { numeric: true })

/** A channel's threads, oldest first, from the messages loaded so far. */
export function channelThreads(state: State, channel: string): { threads: ChannelThread[]; pending: Pending[] } {
  const roots: MessageView[] = []
  const replies = new Map<string, MessageView[]>()
  for (const message of Object.values(state.messages)) {
    if (message.channel !== channel) continue
    const view = shown(state, message.id)!
    if (message.re === null) roots.push(view)
    else replies.set(message.re, [...(replies.get(message.re) ?? []), view])
  }
  roots.sort(byWritten)
  return {
    threads: roots.map((root) => {
      const loaded = (replies.get(root.id) ?? []).sort(byWritten)
      return { root, replies: loaded, pending: state.pending.filter((post) => post.re === root.id), summary: summarize(loaded) }
    }),
    pending: state.pending.filter((post) => post.channel === channel && post.re === null),
  }
}

/**
 * A channel's listed threads by latest activity, the latest last: each with its row's reply count and latest reply,
 * and the replies loaded so far, from an opened thread or the stream.
 */
export function channelRows(state: State, channel: string): { threads: ChannelThread[]; pending: Pending[] } {
  const rows = state.listings[channel]?.rows ?? {}
  const replies = new Map<string, MessageView[]>()
  for (const message of Object.values(state.messages))
    if (message.re !== null && rows[message.re]) replies.set(message.re, [...(replies.get(message.re) ?? []), shown(state, message.id)!])
  const threads = Object.entries(rows).flatMap(([id, row]) => {
    const root = shown(state, id)
    if (!root) return []
    const loaded = (replies.get(id) ?? []).sort(byWritten)
    const last = row.last === null ? null : (shown(state, row.last) ?? null)
    return [{ root, replies: loaded, pending: state.pending.filter((post) => post.re === id), summary: summarize(loaded, row.replies, last) }]
  })
  threads.sort((a, b) => byWritten(a.summary.last ?? a.root, b.summary.last ?? b.root))
  return { threads, pending: state.pending.filter((post) => post.channel === channel && post.re === null) }
}

export function thread(state: State, root: string): Thread | null {
  const view = shown(state, root)
  if (!view) return null
  const replies = Object.values(state.messages)
    .filter((message) => message.re === root)
    .sort(byWritten)
    .map((message) => shown(state, message.id)!)
  return { root: view, replies, pending: state.pending.filter((post) => post.re === root) }
}

/** The newest messages across every channel (that `keep` keeps), oldest first. */
export function recent(state: State, limit = 200, keep: (m: MessageView) => boolean = () => true): MessageView[] {
  return Object.values(state.messages)
    .filter(keep)
    .sort((a, b) => byWritten(b, a))
    .slice(0, limit)
    .reverse()
    .map((message) => shown(state, message.id)!)
}

/** A view's filters, as the board's API takes them: `label` is `key`, `key=value`, or `key=a|b`. */
export type Filter = { from?: string; label: string[]; text?: string }

export const filtering = (filter: Filter) => !!(filter.from || filter.text || filter.label.length)

function hasLabel(labels: Record<string, string>, filter: string): boolean {
  const at = filter.indexOf('=')
  if (at === -1) return filter in labels
  const key = filter.slice(0, at)
  return key in labels && filter.slice(at + 1).split('|').includes(labels[key]!)
}

/** The board's filter rules, for messages already here: labels match on the message or its thread's root. */
export function matches(state: State, message: MessageView, filter: Filter): boolean {
  if (filter.from && (message.from ?? 'board') !== filter.from) return false
  if (filter.text && !message.text.toLowerCase().includes(filter.text.toLowerCase())) return false
  const root = message.re === null ? undefined : state.messages[message.re]
  return filter.label.every((label) => hasLabel(message.labels, label) || (root !== undefined && hasLabel(root.labels, label)))
}

/** Every label key on the loaded messages, with the values each has taken: suggestions for pickers. */
export function knownLabels(state: State): Map<string, Set<string>> {
  const known = new Map<string, Set<string>>()
  for (const message of Object.values(state.messages))
    for (const [key, value] of Object.entries(message.labels)) {
      let values = known.get(key)
      if (!values) known.set(key, (values = new Set()))
      values.add(value)
    }
  return known
}

const GROUP_MS = 5 * 60_000
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString()

export type Groupable = Pick<MessageView, 'by' | 'createdAt' | 'deleted' | 'channel' | 're'>

/**
 * The platform whose logo a message wears, for one that came from a platform: its author's, as their
 * sync key was registered, or else what the board's sync entries say of the key it came through.
 */
export const sourcePlatform = (m: Pick<MessageView, 'from' | 'author'>, platforms: Record<string, string> = {}): string | null =>
  m.from === null ? null : (m.author?.platform ?? platforms[m.from] ?? m.from)

/** Whether `m` continues `previous`: same author and place, same day, close in time, nothing in between. */
export function continues(previous: Groupable | undefined, m: Groupable, hasReplies = false): boolean {
  return (
    !!previous &&
    !hasReplies &&
    !previous.deleted &&
    previous.by.actor === m.by.actor &&
    previous.channel === m.channel &&
    previous.re === m.re &&
    sameDay(previous.createdAt, m.createdAt) &&
    Date.parse(m.createdAt) - Date.parse(previous.createdAt) < GROUP_MS
  )
}

