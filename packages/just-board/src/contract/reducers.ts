import type { ActorKind, Author, Labels } from './schemas.ts'
import { boardContract, type BoardEvent, type Origin } from './contract.ts'

// A2 clones state at every read and snapshot boundary, so these folds mutate
// in place: an event costs O(1) instead of a copy of every message.

export type Message = {
  id: number
  channel: string
  text: string
  re: number | null
  replyTo: number | null
  /** The thread key: the root's event ID. */
  thread: string
  labels: Labels
  reactions: Record<string, string[]>
  mentions: string[]
  by: Author
  noSync: boolean
  /** Where it came from on a platform, if it did. */
  origin: Origin | null
  /** The sync key it came from, or null when written on the board. */
  from: string | null
  createdAt: string
  editedAt: string | null
  deleted: boolean
  /** Sync targets this message didn't reach, with why. A later delivery clears its entry. */
  undelivered: Record<string, string>
}

export type MessagesState = {
  byId: Record<string, Message>
  /** Thread root → reply IDs, in log order. */
  replies: Record<string, number[]>
}

export const iso = (date: Date | string): string =>
  typeof date === 'string' ? date : date.toISOString()

export function foldMessages(
  state: MessagesState,
  event: BoardEvent,
): MessagesState {
  switch (event.type) {
    case 'message.posted': {
      const { payload } = event
      state.byId[event.index] = {
        id: event.index,
        channel: payload.channel,
        text: payload.text,
        re: payload.re,
        replyTo: payload.replyTo,
        thread: payload.thread,
        labels: { ...payload.labels },
        reactions: {},
        mentions: payload.mentions,
        by: payload.by,
        noSync: payload.noSync,
        origin: payload.origin,
        from: payload.from,
        createdAt: iso(event.createdAt),
        editedAt: null,
        deleted: false,
        undelivered: {},
      }
      if (payload.re !== null) (state.replies[payload.re] ??= []).push(event.index)
      return state
    }
    case 'message.edited': {
      const message = state.byId[event.payload.id]
      if (!message || message.deleted) return state
      message.text = event.payload.text
      message.mentions = event.payload.mentions
      message.editedAt = iso(event.createdAt)
      return state
    }
    case 'message.deleted': {
      const message = state.byId[event.payload.id]
      if (!message) return state
      message.deleted = true
      message.text = ''
      message.reactions = {}
      message.mentions = []
      return state
    }
    case 'reaction.added': {
      const message = state.byId[event.payload.id]
      if (!message || message.deleted) return state
      const actors = (message.reactions[event.payload.emoji] ??= [])
      if (!actors.includes(event.payload.by.actor)) actors.push(event.payload.by.actor)
      return state
    }
    case 'reaction.removed': {
      const message = state.byId[event.payload.id]
      if (!message || message.deleted) return state
      const { emoji, by } = event.payload
      const actors = (message.reactions[emoji] ?? []).filter((a) => a !== by.actor)
      if (actors.length > 0) message.reactions[emoji] = actors
      else delete message.reactions[emoji]
      return state
    }
    case 'labels.changed': {
      const message = state.byId[event.payload.id]
      if (!message || message.deleted) return state
      Object.assign(message.labels, event.payload.set)
      for (const key of event.payload.unset) delete message.labels[key]
      return state
    }
    case 'message.sync_failed': {
      const message = state.byId[event.payload.id]
      if (message) message.undelivered[event.payload.target] = event.payload.error
      return state
    }
    case 'message.synced': {
      const message = state.byId[event.payload.id]
      if (message) delete message.undelivered[event.payload.target]
      return state
    }
    default:
      return state
  }
}

export const messagesReducer = boardContract
  .reducer({
    name: 'just-board.messages.v2',
    initialState: { byId: {}, replies: {} } as MessagesState,
  })
  .fold(foldMessages)

export type Channel = {
  path: string
  lastIndex: number
  messages: number
  threads: number
}

export type ChannelsState = Record<string, Channel>

export const channelsReducer = boardContract
  .reducer({
    name: 'just-board.channels.v1',
    initialState: {} as ChannelsState,
  })
  .fold((state, event) => {
    if (event.type !== 'message.posted') return state
    const { channel, re } = event.payload
    const entry = (state[channel] ??= {
      path: channel,
      lastIndex: 0,
      messages: 0,
      threads: 0,
    })
    entry.lastIndex = event.index
    entry.messages += 1
    if (re === null) entry.threads += 1
    return state
  })

export type Actor = {
  id: string
  kind: ActorKind
  handle: string
  name: string
  avatar: string | null
}

export type ActorsState = {
  byId: Record<string, Actor>
  /** Lowercased handle → actor IDs. Handles aren't reserved, so several can share one. */
  byHandle: Record<string, string[]>
}

export function foldActors(state: ActorsState, event: BoardEvent): ActorsState {
  if (event.type !== 'actor.seen') return state
  const { actor, kind, handle, name, avatar } = event.payload
  const previous = state.byId[actor]
  if (previous) {
    const key = previous.handle.toLowerCase()
    const remaining = (state.byHandle[key] ?? []).filter((id) => id !== actor)
    if (remaining.length > 0) state.byHandle[key] = remaining
    else delete state.byHandle[key]
  }
  state.byId[actor] = { id: actor, kind, handle, name, avatar }
  const key = handle.toLowerCase()
  const ids = (state.byHandle[key] ??= [])
  if (!ids.includes(actor)) ids.push(actor)
  return state
}

export const actorsReducer = boardContract
  .reducer({
    name: 'just-board.actors.v1',
    initialState: { byId: {}, byHandle: {} } as ActorsState,
  })
  .fold(foldActors)

/** A copy of a board message on a platform. */
export type ExternalCopy = { thread: string; message: string }

export type SyncedThread = {
  root: number
  channel: string
  /** External channels (start a thread there) and threads (joined), in sync order. */
  targets: string[]
  /** Target → the external thread it resolved to. A thread target resolves to itself. */
  external: Record<string, string>
}

export type SyncState = {
  /** Thread key → its sync. */
  threads: Record<string, SyncedThread>
  /** External thread (grouped) → thread key. */
  byExternalThread: Record<string, string>
  /** Board message → target → its copy there. Includes the copy it came from. */
  copies: Record<string, Record<string, ExternalCopy>>
  /** `${external thread}|${platform message ID}` → board message. */
  byExternalMessage: Record<string, number>
}

/** `slack:C0123ABC:1727.1234` is a thread; `slack:C0123ABC` and `github:owner/repo` are channels. */
export const isThreadTarget = (target: string) => target.slice(target.indexOf(':') + 1).includes(':')

export const externalMessageKey = (thread: string, message: string) => `${thread}|${message}`

const addTarget = (thread: SyncedThread, target: string) => {
  if (!thread.targets.includes(target)) thread.targets.push(target)
}

export function foldSync(state: SyncState, event: BoardEvent): SyncState {
  switch (event.type) {
    case 'message.posted': {
      const { payload } = event
      if (payload.re === null)
        state.threads[payload.thread] = { root: event.index, channel: payload.channel, targets: [], external: {} }
      const origin = payload.origin
      if (!origin) return state
      const thread = state.threads[payload.thread]
      if (thread && payload.re === null) {
        addTarget(thread, origin.thread)
        thread.external[origin.thread] = origin.thread
        state.byExternalThread[origin.thread] = payload.thread
      }
      const precise = origin.subthread ?? origin.thread
      ;(state.copies[event.index] ??= {})[origin.thread] = { thread: precise, message: origin.message }
      state.byExternalMessage[externalMessageKey(precise, origin.message)] = event.index
      return state
    }
    case 'thread.synced': {
      const thread = state.threads[event.payload.thread]
      if (!thread) return state
      addTarget(thread, event.payload.target)
      if (isThreadTarget(event.payload.target)) {
        thread.external[event.payload.target] = event.payload.target
        state.byExternalThread[event.payload.target] = event.payload.thread
      }
      return state
    }
    case 'message.synced': {
      const { id, target, external } = event.payload
      ;(state.copies[id] ??= {})[target] = external
      state.byExternalMessage[externalMessageKey(external.thread, external.message)] = id
      const thread = state.threads[event.payload.thread]
      if (thread && thread.root === id && !isThreadTarget(target)) {
        thread.external[target] = external.thread
        state.byExternalThread[external.thread] = event.payload.thread
      }
      return state
    }
    default:
      return state
  }
}

export const syncReducer = boardContract
  .reducer({
    name: 'just-board.sync.v1',
    initialState: { threads: {}, byExternalThread: {}, copies: {}, byExternalMessage: {} } as SyncState,
  })
  .fold(foldSync)
