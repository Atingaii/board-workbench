import { z } from 'zod'
import type { Adapter, Author as ChatAuthor, Chat, FileUpload, Message as ChatMessage } from 'chat'
import type { Message, Actor } from '../contract/reducers.ts'
import type { BoardClient } from '../client/client.ts'
import type { ExternalAuthor, ExternalEvent } from '../contract/contract.ts'
import { externalAuthor } from './types.ts'
import { createChat, markdownOf } from './chat.ts'
import { immutable, type ProviderEvent, type SyncOverrides, type SyncResult } from './events.ts'

export const ResolvedTarget = z.object({ target: z.string().min(1), channel: z.string().min(1), kind: z.enum(['channel', 'thread']) }).strict()
export type ResolvedTarget = z.infer<typeof ResolvedTarget>
export type InterceptedEvent = { event: ExternalEvent; raw: unknown; dedupe: string }

export type SyncClient<E extends ProviderEvent = ProviderEvent> = Omit<BoardClient, 'sync'> & {
  sync(id: number, target: string): ReturnType<BoardClient['sync']>
  sync(channel: string, event: E, overrides?: SyncOverrides): Promise<SyncResult>
}

export type SyncHandler<E extends ProviderEvent> = (args: { event: E; board: SyncClient<E> }) => unknown
export type SyncContext = {
  key: string
  event: ExternalEvent
  raw: unknown
  board: BoardClient
  client<E extends ProviderEvent>(event: E): SyncClient<E>
  apply(channel: string, overrides?: SyncOverrides): Promise<SyncResult>
}

export type ProviderMapping = {
  channel?: string
  mode: 'legacy' | 'all'
  run?: (context: SyncContext) => unknown
}

export type RenderInput = { message: Readonly<Message>; author: Readonly<Actor> | null; label: string; target: string }
export type EventMapping<E extends ProviderEvent> = string | SyncHandler<E> | { channel: string; run: SyncHandler<E> }

export type FileDelivery = { message: string; files: string[] }

export type LegacyMessage = Pick<Extract<ExternalEvent, { kind: 'message' }>, 'text' | 'author' | 'channel' | 'thread'> & { id: string; raw: unknown }
export type LegacyMessageHandler = (args: { message: LegacyMessage; board: BoardClient }) => unknown

export type SyncTransport = {
  platform: string
  adapter: Adapter
  author?(author: ChatAuthor, raw: unknown): ExternalAuthor
  render?(input: RenderInput): string
  canStartThreads?: boolean
  singleReaction?: boolean
  resolveChannel(key: string): Promise<string>
  resolveTarget(target: string): Promise<ResolvedTarget>
  groupThread?(thread: string): string
  channelOf?(thread: string): string
  isRoot?(thread: string, message: string): boolean
  fromChatId?(id: string): string
  toChatId?(id: string): string
  context?(message: ChatMessage): string | null
  markdown?(message: ChatMessage): string
  avatar?(message: ChatMessage): Promise<string | null>
  fetchRoot?(thread: string): Promise<{ text: string; labels: Record<string, string>; author: ExternalAuthor; raw?: unknown }>
  intercept?(key: string, headers: Headers, body: string): InterceptedEvent[]
  uploadFiles?(thread: string, files: FileUpload[]): Promise<FileDelivery>
  fileIds?(raw: unknown): string[]
  refusesFiles?(error: unknown): boolean
  deleteFiles?(ids: string[]): Promise<void>
  startTyping?(thread: string, latest: string | null): Promise<void>
}

export abstract class SyncProvider<E extends ProviderEvent = ProviderEvent> {
  readonly platform: string
  readonly adapter: Adapter
  readonly canStartThreads: boolean
  readonly singleReaction: boolean
  readonly transport: SyncTransport
  readonly mappings: Record<string, ProviderMapping> = {}

  constructor(transport: SyncTransport) {
    this.transport = transport
    this.platform = transport.platform
    this.adapter = transport.adapter
    this.canStartThreads = transport.canStartThreads ?? false
    this.singleReaction = transport.singleReaction ?? false
  }

  author(author: ChatAuthor, raw: unknown) {
    return this.transport.author?.(author, raw) ?? externalAuthor(this.platform, author)
  }

  createChat(): Chat {
    return createChat(this.adapter)
  }

  resolveChannel(key: string) {
    return this.transport.resolveChannel(key)
  }

  async resolveTarget(target: string) {
    return ResolvedTarget.parse(await this.transport.resolveTarget(target))
  }

  groupThread(thread: string) {
    return this.transport.groupThread?.(thread) ?? thread
  }

  isRoot(thread: string, message: string) {
    return this.transport.isRoot?.(thread, message) ?? false
  }

  context(message: ChatMessage) {
    return this.transport.context?.(message) ?? null
  }

  markdown(message: ChatMessage) {
    return this.transport.markdown?.(message) ?? markdownOf(message)
  }


  abstract event(context: Pick<SyncContext, 'key' | 'event' | 'raw'>): E

  sync(context: SyncContext, channel: string, _event: E, overrides?: SyncOverrides): Promise<SyncResult> {
    return context.apply(channel, overrides)
  }

  render(input: RenderInput): string {
    return this.transport.render?.(input) ?? `**${input.label}**: ${input.message.text}`
  }

  protected legacyMessage(key: string, value: string | LegacyMessageHandler) {
    if (typeof value === 'string') return this.map(key, value)
    this.mappings[key] = {
      mode: 'legacy',
      run: ({ event, raw, board }) => {
        if (event.kind !== 'message') return
        return value({ message: { id: event.message, text: event.text, author: event.author, channel: event.channel, thread: event.thread, raw }, board })
      },
    }
  }

  protected map(key: string, value: EventMapping<E>) {
    if (typeof value === 'string') {
      this.mappings[key] = { channel: value, mode: 'all' }
      return
    }
    const handler = typeof value === 'function' ? value : value.run
    this.mappings[key] = {
      mode: 'all',
      ...(typeof value === 'object' ? { channel: value.channel } : {}),
      run: (context) => {
        const event = immutable(this.event(context))
        return handler({ event, board: context.client(event) })
      },
    }
  }
}
