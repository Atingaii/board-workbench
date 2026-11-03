import { createHash } from 'node:crypto'
import type { ReactionEvent } from 'chat'
import type { z } from 'zod'
import { ChatSyncProvider, type ChatInput, type ChatTransport } from './chat-provider.ts'
import { envelope, eventSchema } from './events.ts'
import type { SyncFn } from './fn.ts'
import type { SyncContext, SyncProvider } from './provider.ts'

export type { ChatInput } from './chat-provider.ts'
export { channels } from './fn.ts'

const schemaOf = <P extends string>(platform: P) => eventSchema(platform, 'message')
/** What a `chatSdk()` entry's sync function reads as `sync.event`. `P` is its platform's name. */
export type ChatSdkEvent<P extends string = string> = z.infer<ReturnType<typeof schemaOf<P>>>

/** The adapter, and hooks for what board can't read from it. Every hook is optional. */
export type ChatSdkOptions<P extends string = string> = Omit<ChatTransport, 'platform'> & {
  /** The platform's name, in author IDs, author labels, and `vb sources`. The adapter's `name` unless given. */
  platform?: P
  /**
   * Whether a new board root opens a thread of its own in a mirrored channel, as on Discord or
   * Teams. Off unless given: on most platforms a chat is one conversation, so the root stays on
   * the board, and threads that came from the platform sync both ways.
   */
  canStartThreads?: boolean
  /** The platform's ID for one reaction occurrence, the same on every redelivery. Without it, a reaction is known by its payload. */
  reactionId?(reaction: ReactionEvent): string
}

/**
 * Syncs any Chat SDK adapter with the board: `sync` is what each event does, both ways, like
 * `channels({ '-1001234567890': 'support' })`. Channels are the adapter's own IDs, without its
 * prefix. Slack, GitHub, and Linear have entries of their own, with more than this reads.
 */
export function chatSdk<P extends string = string>(options: ChatSdkOptions<P>, sync: SyncFn<ChatSdkEvent<P>>): SyncProvider<ChatSdkEvent<P>> {
  if (!options?.adapter?.name) throw new Error('chatSdk needs a Chat SDK adapter: chatSdk({ adapter }, channels({ … }))')
  return new ChatSdkProvider(options, sync)
}

class ChatSdkProvider<P extends string> extends ChatSyncProvider<ChatSdkEvent<P>> {
  private readonly schema: ReturnType<typeof schemaOf<P>>
  private readonly reactionId: ((reaction: ReactionEvent) => string) | undefined

  constructor({ platform, reactionId, ...transport }: ChatSdkOptions<P>, sync: SyncFn<ChatSdkEvent<P>>) {
    const name = platform ?? (transport.adapter.name as P)
    super({ ...transport, platform: name }, sync)
    this.schema = schemaOf(name)
    this.reactionId = reactionId
  }

  override eventId(key: string, input: ChatInput): string {
    if (input.kind !== 'reaction') return super.eventId(key, input)
    const reaction = input.reaction
    const occurrence = this.reactionId?.(reaction) ?? digest(reaction.raw)
    return `reaction:${key}:${this.toNative(reaction.threadId)}|${reaction.messageId}|${reaction.rawEmoji}|${reaction.user.userId}|${reaction.added}|${occurrence}`
  }

  override event(context: SyncContext): ChatSdkEvent<P> {
    return this.schema.parse(envelope(this.platform, context.key, context.event, context.raw, context.id))
  }
}

/** A payload's identity: a redelivery is the same JSON, its keys in any order. */
function digest(raw: unknown): string {
  let json = ''
  try {
    json = JSON.stringify(raw, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value) ?? ''
  } catch {
    // A payload that isn't JSON has no identity of its own: its reaction is known by the rest.
  }
  return createHash('sha256').update(json).digest('base64url')
}
