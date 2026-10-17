import type { BoardEvent } from '../contract/contract.ts'
import { foldMessages, type Message } from '../contract/reducers.ts'

/** The message an event concerns, if any. */
export function concernedMessageId(event: BoardEvent): number | null {
  if (event.type === 'message.posted') return event.index
  if ('id' in event.payload) return event.payload.id
  return null
}

/** A root's thread summary: replies that aren't deleted, and the latest one's ID (its own when none). */
export type Summary = { replies: number; at: number }

/** What the tables hold before an event, as far as it matters to that event. */
export type Before = {
  message: Message | undefined
  /** Its root's summary, when it's a reply. */
  root: Summary | undefined
  /** For a delete of a root's latest reply: the newest other reply that isn't deleted. */
  previousLast?: number | null
}

/** What an event changes. */
export type Change = {
  /** The message as it is after the event, when the event changed it. */
  message?: { after: Message; created: boolean; terms: boolean }
  /** A root's new summary. */
  summary?: { root: number } & Summary
}

const termsOf = (message: Message) => JSON.stringify([message.labels, message.mentions])

/**
 * Applies one event to what the tables hold, with the same fold the board has
 * always used, on a state of just that message. Pure: the caller reads `before`
 * and writes the change.
 */
export function project(before: Before, event: BoardEvent): Change {
  const id = concernedMessageId(event)
  if (id === null) return {}
  const current = before.message
  if (event.type !== 'message.posted' && !current) return {}
  const state = { byId: current ? { [id]: structuredClone(current) } : {}, replies: {} }
  foldMessages(state, event)
  const after = state.byId[id]
  if (!after) return {}
  const change: Change = {}
  const created = current === undefined
  if (created || JSON.stringify(after) !== JSON.stringify(current))
    change.message = { after, created, terms: created || termsOf(after) !== termsOf(current!) }

  if (event.type === 'message.posted') {
    if (after.re === null) change.summary = { root: id, replies: 0, at: id }
    else if (before.root) change.summary = { root: after.re, replies: before.root.replies + 1, at: id }
  } else if (event.type === 'message.deleted' && current && !current.deleted && current.re !== null && before.root) {
    const at = before.root.at === id ? (before.previousLast ?? current.re) : before.root.at
    change.summary = { root: current.re, replies: before.root.replies - 1, at }
  }
  return change
}
