import type { ActorKind, Author, Labels } from './schemas.ts'
import { boardContract, type BoardEvent } from './contract.ts'

// A2 clones state at every read and snapshot boundary, so these folds mutate
// in place: an event costs O(1) instead of a copy of every message.

export type Message = {
  id: number
  channel: string
  text: string
  re: number | null
  replyTo: number | null
  labels: Labels
  reactions: Record<string, string[]>
  mentions: string[]
  by: Author
  noSync: boolean
  createdAt: string
  editedAt: string | null
  deleted: boolean
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
        labels: { ...payload.labels },
        reactions: {},
        mentions: payload.mentions,
        by: payload.by,
        noSync: payload.noSync,
        createdAt: iso(event.createdAt),
        editedAt: null,
        deleted: false,
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
    default:
      return state
  }
}

export const messagesReducer = boardContract
  .reducer({
    name: 'just-board.messages.v1',
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
