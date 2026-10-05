import type { Adapter, Author as ChatAuthor, Chat, FileUpload, Message as ChatMessage } from 'chat'
import type { BoardClient } from '../client/client.ts'
import type { ExternalAuthor, ExternalEvent } from '../contract/contract.ts'
import type { Actor } from '../contract/reducers.ts'

/** A lifecycle event read from a raw platform webhook, with its dedupe key. */
export type InterceptedEvent = { event: ExternalEvent; raw: unknown; dedupe: string }

/**
 * What a platform module tells the sync core. Platform thread and channel IDs
 * here have no prefix: `C0123:1727.1` for Slack, `owner/repo:12` for GitHub.
 */
export type SyncPlatform = {
  readonly platform: string
  readonly adapter: Adapter
  /** Builds the entry's Chat SDK instance; see `createChat`. */
  createChat(): Chat
  /** Whether a new board thread can start a thread in one of its channels. */
  readonly canStartThreads: boolean
  /**
   * Uploads a message's files into its thread (a Chat SDK thread ID), after
   * the message, and answers the platform's IDs for them. A platform without
   * it gets a line per file in the text instead.
   */
  uploadFiles?(thread: string, files: FileUpload[]): Promise<string[]>
  /** Whether an `uploadFiles` error means the platform won't take files, so lines stand in, rather than that it failed for now. */
  refusesFiles?(error: unknown): boolean
  /** Deletes files `uploadFiles` uploaded, when their message is deleted on the board. */
  deleteFiles?(ids: string[]): Promise<void>
  /** Platform channel key → board channel (a mirror) or a function (an inbound handler). */
  readonly mappings: Readonly<Record<string, string | InboundFunction>>
  /** `#prs` → `C0123ABC`. */
  resolveChannel(key: string): Promise<string>
  /** A Chat SDK thread or channel ID, without its adapter prefix, as the board writes it, when they differ. */
  fromChatId?(id: string): string
  /** The reverse of `fromChatId`. */
  toChatId?(id: string): string
  /**
   * Shows typing in a thread (a Chat SDK thread ID), when the adapter's own
   * `startTyping` needs help. `latest` is the newest platform message ID that
   * came from that thread, as the board knows it, or null.
   */
  startTyping?(thread: string, latest: string | null): Promise<void>
  /** Each person keeps one reaction per message, as on WhatsApp: a new one replaces theirs, and a removal names none. */
  readonly singleReaction?: boolean
  /** Folds sub-threads into the thread a board thread maps to. */
  groupThread(thread: string): string
  /** The channel a thread is in, when it isn't Chat SDK's: GitHub splits a repo into its PRs and its issues. */
  channelOf?(thread: string): string
  /** Whether a message is its thread's first message. */
  isRoot(thread: string, messageId: string): boolean
  /** Fetches a separate root for an unseen thread whose inbound messages are comments. */
  fetchRoot?(thread: string): Promise<{ text: string; labels: Record<string, string>; author: ExternalAuthor }>
  /** Short context for a message, e.g. the file and line of a review comment. */
  context(message: ChatMessage): string | null
  /** How a mentioned actor reads on this platform, when it's one of its own: `<@U0456>` in Slack. */
  mention?(actor: Actor): string | null
  /** A message's text as markdown, the board's format. */
  markdown(message: ChatMessage): string
  /** Its author's avatar, when the platform can tell. Best effort: null otherwise. */
  avatar?(message: ChatMessage): Promise<string | null>
  /** Lifecycle events Chat SDK doesn't model, read from a verified raw webhook. */
  intercept?(key: string, headers: Headers, body: string): InterceptedEvent[]
  /** The argument an inbound function receives. */
  handlerArgs(event: ExternalEvent, raw: unknown, board: BoardClient): unknown
}

// The functions are typed per platform module; the core only calls them.
export type InboundFunction = (args: never) => unknown

export function externalAuthor(platform: string, author: ChatAuthor): ExternalAuthor {
  const handle = author.userName || author.userId
  return {
    id: `${platform}:user:${author.userId}`,
    handle,
    name: author.fullName || handle,
    avatar: null,
    isBot: author.isBot === true,
  }
}
