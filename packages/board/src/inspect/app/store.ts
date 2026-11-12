import type { ActorView, BlockView, BoardEventView, ChannelView, Discovery, GrantView, Me, MessageView, RegistrationView, ScheduleView, SchemaView } from '../../api/routes.ts'
// `@vercel/board/schemas`, in an app of yours.
import { findBlocks } from '../../contract/blocks.ts'
import { canonicalEmoji } from '../../contract/emoji.ts'
import { shownName } from './words.ts'

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
  /** The board's schema registry, once it's read: what a block's fields mean. */
  schemas: SchemaView[] | null
  /** What the board answered instead of its registry, when it refused. */
  schemasRefused: string | null
  /** The board's grants, as it answered when asked for them. */
  grants: Listed<GrantView>
  /** Scheduled messages: pending ones, or with `everySchedule` done and canceled ones too. Nothing in the feed says when one changes, so the page asks again. */
  schedules: Listed<ScheduleView>
  everySchedule: boolean
  /** The watchers boards elsewhere registered here. */
  watchers: Listed<RegistrationView>
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
  schemas: null,
  schemasRefused: null,
  grants: { is: 'unasked' },
  schedules: { is: 'unasked' },
  everySchedule: false,
  watchers: { is: 'unasked' },
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

// #region guide inspector/merge.ts
/**
 * Takes in views of messages, keeping the newer of each. A message's `version` grows with every
 * change to it, so of two views the higher is newer, whatever order they arrive in: a snapshot
 * that lands after the event that outdated it changes nothing.
 */
export function newest(known: Record<string, MessageView>, views: MessageView[]): Record<string, MessageView> {
  let next = known
  for (const view of views) {
    if ((next[view.id]?.version ?? -1) > view.version) continue
    if (next === known) next = { ...known }
    next[view.id] = view
  }
  return next
}
// #endregion

/** Takes in message views, the newer of each, with what a newer view settles: the changes of yours it confirms. */
export function merge(state: State, views: MessageView[]): State {
  const messages = newest(state.messages, views)
  if (messages === state.messages) return state
  let ops = state.ops
  for (const view of views) {
    // An older view changed nothing.
    if (messages[view.id] !== view) continue
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
  return { ...state, messages, ops }
}

// #region guide inspector/pending.ts
/**
 * The post on its way that a message stands for: yours, in the same place, saying the same. The
 * feed can bring the message before the board answers the post, so whichever comes first replaces
 * the pending one, and the two never show at once.
 */
export function landed<Post extends { channel: string; re: string | null; text: string; error: string | null }>(pending: Post[], message: MessageView, me: string): Post | undefined {
  if (message.by.actor !== me) return undefined
  return pending.find((post) => post.error === null && post.channel === message.channel && post.re === message.re && post.text === message.text)
}
// #endregion

/** Folds one live event in: the message it concerns, channel counts, and actor details. */
export function applyEvent(state: State, event: BoardEventView): State {
  let next = event.message ? merge(state, [event.message]) : state
  if (event.type === 'message.posted' && event.message) {
    const post = landed(next.pending, event.message, next.me?.actor ?? '')
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
    next = { ...next, actors: { ...next.actors, [actor]: { kind: kind === 'profile' ? 'agent' : kind, handle, name, avatar, ...(via ? { via } : {}), ...(platform ? { platform } : {}) } } }
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

/**
 * Messages in the order they were written: by when, and between two in the same millisecond, by
 * ID, digits compared as numbers. IDs are the board's to choose, so this is only a tiebreak.
 */
export const byWritten = (a: Pick<MessageView, 'createdAt' | 'id'>, b: Pick<MessageView, 'createdAt' | 'id'>) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id, undefined, { numeric: true })

/** A channel's threads, oldest first, from the messages loaded so far. */
export function channelThreads(state: State, channel: string): { threads: Thread[]; pending: Pending[] } {
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
    threads: roots.map((root) => ({
      root,
      replies: (replies.get(root.id) ?? []).sort(byWritten),
      pending: state.pending.filter((post) => post.re === root.id),
    })),
    pending: state.pending.filter((post) => post.channel === channel && post.re === null),
  }
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

/**
 * Whether `m` continues `previous` under one header: a reply by the same author in the same thread,
 * the same day and close in time, with nothing in between. A root never does: it starts a thread,
 * so it shows who started it, and when.
 */
export function continues(previous: Groupable | undefined, m: Groupable, hasReplies = false): boolean {
  return (
    !!previous &&
    m.re !== null &&
    !hasReplies &&
    !previous.deleted &&
    previous.by.actor === m.by.actor &&
    previous.channel === m.channel &&
    previous.re === m.re &&
    sameDay(previous.createdAt, m.createdAt) &&
    Date.parse(m.createdAt) - Date.parse(previous.createdAt) < GROUP_MS
  )
}


// --- who's who ---------------------------------------------------------------------------------

/** Who's looking: what the board says of you (`team.me()`), and what you may do where. */
export type Viewer = {
  actor: string
  principal: string
  may(permission: 'post' | 'manage', channel: string): boolean
  /** `manage` at `*`: what registering a schema and listing grants need. */
  manages: boolean
}

/**
 * An actor or a principal by name: as the board last said who they are, or else what their ID
 * says, a profile and the last part of its principal's (`local:user:julian+codex` is `codex via julian`).
 */
export function nameOf(state: State, id: string): string {
  const known = state.actors[id]
  if (known) return shownName(known)
  const plus = id.indexOf('+')
  const principal = plus === -1 ? id : id.slice(0, plus)
  const tail = state.actors[principal]?.name ?? principal.slice(principal.lastIndexOf(':') + 1)
  return plus === -1 ? tail : `${id.slice(plus + 1)} via ${tail}`
}

// --- blocks and schemas -------------------------------------------------------------------

/** A piece of a message's body: prose, or a block the board read out of it. */
export type BodyPart = { text: string } | { block: BlockView }

/**
 * A message's text as prose and blocks, in order. A block is a fence in the text that names a
 * schema; only the ones the board lists are blocks (it checked them), so a fence in a platform's
 * text stays text. Blocks the text can't place come after it.
 */
export function bodyParts(text: string, blocks: BlockView[]): BodyPart[] {
  if (blocks.length === 0) return text.trim() ? [{ text }] : []
  const fences = findBlocks(text).filter((found) => found.data !== undefined && found.name !== undefined)
  if (fences.length !== blocks.length) return [...(text.trim() ? [{ text }] : []), ...blocks.map((block) => ({ block }))]
  const parts: BodyPart[] = []
  let at = 0
  fences.forEach((fence, i) => {
    const before = text.slice(at, fence.start)
    if (before.trim()) parts.push({ text: before })
    parts.push({ block: blocks[i]! })
    at = fence.end
  })
  if (text.slice(at).trim()) parts.push({ text: text.slice(at) })
  return parts
}

/** A registered schema version, or undefined for one the registry doesn't hold (or hasn't been read). */
export const schemaOf = (state: Pick<State, 'schemas'>, name: string, version: number): SchemaView | undefined =>
  state.schemas?.find((schema) => schema.name === name && schema.version === version)

/** A block's fields, in the order its schema lists them, then any it doesn't: each with what the schema says of it. */
export function blockFields(block: BlockView, schema: SchemaView | undefined): { name: string; value: unknown; description?: string }[] {
  const properties = (schema?.schema.properties ?? {}) as Record<string, { description?: unknown } | undefined>
  const names = [...Object.keys(properties).filter((name) => name in block.data), ...Object.keys(block.data).filter((name) => !(name in properties))]
  return names.map((name) => {
    const description = properties[name]?.description
    return { name, value: block.data[name], ...(typeof description === 'string' ? { description } : {}) }
  })
}

/** The registry by name: each schema's versions, oldest first, built-ins before the board's own. */
export function schemasByName(schemas: SchemaView[]): { name: string; builtIn: boolean; versions: SchemaView[] }[] {
  const names = new Map<string, SchemaView[]>()
  for (const schema of schemas) names.set(schema.name, [...(names.get(schema.name) ?? []), schema])
  return [...names]
    .map(([name, versions]) => ({ name, builtIn: versions.some((v) => v.builtIn), versions: versions.sort((a, b) => a.version - b.version) }))
    .sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.name.localeCompare(b.name))
}

/** Takes in a schema version the board registered, once. */
export function addSchema(state: State, schema: SchemaView): State {
  if (state.schemas?.some((known) => known.id === schema.id)) return state
  return { ...state, schemas: [...(state.schemas ?? []), schema] }
}

// --- what a board answers when asked for a list ---------------------------------------------

/** A list the page asked the board for: not asked yet, on its way, here, or what the board answered instead. */
export type Listed<T> = { is: 'unasked' } | { is: 'loading' } | { is: 'here'; items: T[] } | { is: 'failed'; why: string }

// --- access -----------------------------------------------------------------------------------

/**
 * What a grant gives, from lines as the CLI writes them: `work/=read,post`, `secrets/=none`,
 * `*=all`. Which patterns and permissions exist is the board's to say; this only reads the shape.
 */
export function canFromLines(text: string): { can: Record<string, 'all' | 'none' | string[]> } | { problem: string } {
  const can: Record<string, 'all' | 'none' | string[]> = {}
  for (const line of text.split(/[\n;]/).map((line) => line.trim()).filter(Boolean)) {
    const at = line.indexOf('=')
    const pattern = at === -1 ? '' : line.slice(0, at).trim()
    const gives = line.slice(at + 1).trim()
    if (!pattern || !gives) return { problem: `${line} isn't pattern=permissions, like work/=read,post` }
    can[pattern] = gives === 'all' || gives === 'none' ? gives : gives.split(',').map((permission) => permission.trim()).filter(Boolean)
  }
  return Object.keys(can).length > 0 ? { can } : { problem: 'say what it gives: a line like work/=read,post' }
}

// --- schedules ---------------------------------------------------------------------------------

/** The pending schedules that reply in a thread, soonest first. */
export function threadSchedules(state: State, root: string): ScheduleView[] {
  if (state.schedules.is !== 'here') return []
  return state.schedules.items.filter((schedule) => schedule.re === root && schedule.state === 'pending').sort((a, b) => (a.next ?? '').localeCompare(b.next ?? ''))
}
