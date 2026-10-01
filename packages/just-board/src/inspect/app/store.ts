import type { ActorView, BoardEventView, ChannelView, Discovery, Me, MessageView } from '../../api/routes.ts'
import { canonicalEmoji } from '../../contract/emoji.ts'

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
  re: number | null
  text: string
  noSync: boolean
  createdAt: string
  error: string | null
}

export type State = {
  me: Me | null
  discovery: Discovery | null
  channels: Record<string, ChannelView>
  /** Messages as the board last showed them. */
  messages: Record<number, MessageView>
  /** The log index each message's view reflects; older views never replace newer ones. */
  asOf: Record<number, number>
  ops: Record<number, { id: string; op: Op }[]>
  pending: Pending[]
  actors: Record<string, ActorView>
  /** The stream's position. */
  cursor: number
  live: 'connecting' | 'live' | 'reconnecting'
}

export const initialState: State = {
  me: null,
  discovery: null,
  channels: {},
  messages: {},
  asOf: {},
  ops: {},
  pending: [],
  actors: {},
  cursor: 0,
  live: 'connecting',
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
      return { ...message, deleted: true, text: '', reactions: {}, mentions: [] }
    case 'label': {
      const labels = { ...message.labels, ...op.set }
      for (const key of op.unset) delete labels[key]
      return { ...message, labels }
    }
  }
}

/** Takes in message views that reflect log index `asOf`, keeping whichever is newer. */
export function merge(state: State, views: MessageView[], asOf: number): State {
  let messages = state.messages
  let marks = state.asOf
  let ops = state.ops
  for (const view of views) {
    if ((marks[view.id] ?? -1) > asOf) continue
    if (messages === state.messages) {
      messages = { ...messages }
      marks = { ...marks }
    }
    messages[view.id] = view
    marks[view.id] = asOf
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
  return messages === state.messages && ops === state.ops ? state : { ...state, messages, asOf: marks, ops }
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

/** Folds one live event in: the message it concerns, channel counts, and actor details. */
export function applyEvent(state: State, event: BoardEventView): State {
  let next = event.message ? merge(state, [event.message], event.index) : state
  if (event.type === 'message.posted' && event.message) {
    const post = landed(next, event.message)
    if (post) next = { ...next, pending: next.pending.filter((p) => p !== post) }
    const { channel, re } = event.message
    const known = next.channels[channel]
    if (!known || known.lastIndex < event.index)
      next = {
        ...next,
        channels: {
          ...next.channels,
          [channel]: {
            path: channel,
            lastIndex: event.index,
            messages: (known?.messages ?? 0) + 1,
            threads: (known?.threads ?? 0) + (re === null ? 1 : 0),
          },
        },
      }
  }
  if (event.type === 'actor.seen') {
    const actor = event.payload as { actor: string; handle: string; name: string; avatar: string | null }
    next = { ...next, actors: { ...next.actors, [actor.actor]: { handle: actor.handle, name: actor.name, avatar: actor.avatar } } }
  }
  return event.index > next.cursor ? { ...next, cursor: event.index } : next
}

export function addOp(state: State, message: number, id: string, op: Op): State {
  return { ...state, ops: { ...state.ops, [message]: [...(state.ops[message] ?? []), { id, op }] } }
}

export function dropOp(state: State, message: number, id: string): State {
  const left = (state.ops[message] ?? []).filter((entry) => entry.id !== id)
  const ops = { ...state.ops }
  if (left.length > 0) ops[message] = left
  else delete ops[message]
  return { ...state, ops }
}

/** A message as this page shows it: the board's view, your pending changes, and fresh author details. */
export function shown(state: State, id: number, now = new Date().toISOString()): MessageView | undefined {
  const message = state.messages[id]
  if (!message) return undefined
  let out = message
  for (const { op } of state.ops[id] ?? []) out = apply(out, op, state.me?.actor ?? '', now)
  const actor = state.actors[message.by.actor]
  return actor ? { ...out, author: actor } : out
}

export type Thread = { root: MessageView; replies: MessageView[]; pending: Pending[] }

/** A channel's threads, oldest first, from the messages loaded so far. */
export function channelThreads(state: State, channel: string): { threads: Thread[]; pending: Pending[] } {
  const roots: MessageView[] = []
  const replies = new Map<number, MessageView[]>()
  for (const message of Object.values(state.messages)) {
    if (message.channel !== channel) continue
    const view = shown(state, message.id)!
    if (message.re === null) roots.push(view)
    else replies.set(message.re, [...(replies.get(message.re) ?? []), view])
  }
  roots.sort((a, b) => a.id - b.id)
  return {
    threads: roots.map((root) => ({
      root,
      replies: (replies.get(root.id) ?? []).sort((a, b) => a.id - b.id),
      pending: state.pending.filter((post) => post.re === root.id),
    })),
    pending: state.pending.filter((post) => post.channel === channel && post.re === null),
  }
}

export function thread(state: State, root: number): Thread | null {
  const view = shown(state, root)
  if (!view) return null
  const replies = Object.values(state.messages)
    .filter((message) => message.re === root)
    .sort((a, b) => a.id - b.id)
    .map((message) => shown(state, message.id)!)
  return { root: view, replies, pending: state.pending.filter((post) => post.re === root) }
}

/** The newest messages across every channel, oldest first. */
export function recent(state: State, limit = 200): MessageView[] {
  return Object.values(state.messages)
    .sort((a, b) => b.id - a.id)
    .slice(0, limit)
    .reverse()
    .map((message) => shown(state, message.id)!)
}
