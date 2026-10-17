import type { A2Store } from 'experimental-a2/server'
import type { BoardEvent } from '../contract/contract.ts'
import type { Message } from '../contract/reducers.ts'

/**
 * What a query matches, resolved by the board: handles are already actor and
 * principal sets, so a backend never needs the actors.
 */
export type MessageFilter = {
  /** One channel, or with `subtree` it and every channel under it. */
  channel?: { path: string; subtree: boolean }
  /** A thread: its root and its replies. */
  re?: number
  /** Written by one of these actors, or by an agent of one of these people. */
  by?: { actors: readonly string[]; principals: readonly string[] }
  /** Mentions one of these actors. */
  mentions?: readonly string[]
  /** The sync key it came from, or `board`. */
  from?: string
  /** Lowercased: a substring of the lowercased text. */
  text?: string
  /** Each on the message or its thread's root; `values: null` is any value. */
  labels?: readonly { key: string; values: readonly string[] | null }[]
}

/** By message ID: `after` takes the first `limit` after it; otherwise the last `limit`. */
export type Page = { before?: number; after?: number; limit: number }

/** A thread as `/threads` lists it: its root, how many replies aren't deleted, and the latest. */
export type ThreadSummary = { root: Message; replies: number; last: Message | null }

/**
 * The board's messages, kept from its log. Each read says which log index it
 * reflects (`position`), so a reader knows what it has seen.
 */
export interface MessageTables {
  /** The last log index applied. */
  position(): Promise<number>
  /** Applies one board event, exactly once: an event at or below the position changes nothing. */
  apply(event: BoardEvent): Promise<void>
  /**
   * Applies `event` only if it's the very next one, and says whether it did: a
   * writer catching the tables up on its own write, without waiting on the consumer.
   */
  applyNext(event: BoardEvent): Promise<boolean>
  message(id: number): Promise<Message | null>
  /** The message a post with this event ID created. A root's thread key is one. */
  byEventId(eventId: string): Promise<Message | null>
  /** Each of `ids` as it was right after event `index`; one not posted by then is absent. */
  messagesAt(ids: readonly number[], index: number): Promise<Map<number, Message>>
  /** A thread's root and every reply, deleted ones included, by ID. */
  thread(root: number): Promise<Message[]>
  messages(filter: MessageFilter, page: Page): Promise<{ messages: Message[]; position: number }>
  /** Threads with a message that matches, by their latest reply. */
  threads(filter: MessageFilter, page: Page): Promise<{ threads: ThreadSummary[]; position: number }>
  close(): Promise<void>
}

/**
 * Where a board keeps everything: its A2 log, and the tables it reads from.
 * Create one with `postgres()`, `sqlite()`, or `memory()` from `vboard/store-*`.
 */
export type BoardStore = {
  /** The board's A2 store; undefined leaves the choice to A2's defaults. */
  readonly log: A2Store | undefined
  readonly tables: MessageTables
  close(): Promise<void>
}
