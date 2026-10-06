import { z } from 'zod'
import type { Message, Actor } from '../contract/reducers.ts'
import type { BoardClient } from '../client/client.ts'
import { ExternalEvent, type ExternalAuthor, type ExternalFile, type ExternalLink, type Link } from '../contract/contract.ts'
import { immutable, type ProviderEvent, type SyncOverrides, type SyncResult, type SyncRoot } from './events.ts'

export const ResolvedTarget = z.object({ target: z.string().min(1), channel: z.string().min(1), kind: z.enum(['channel', 'thread']) }).strict()
export type ResolvedTarget = z.infer<typeof ResolvedTarget>

export type SyncClient<E extends ProviderEvent = ProviderEvent> = Omit<BoardClient, 'sync'> & {
  sync(id: number, target: string): ReturnType<BoardClient['sync']>
  sync(channel: string, event: E, overrides?: SyncOverrides): Promise<SyncResult>
}

export type SyncHandler<E extends ProviderEvent> = (args: { event: E; board: SyncClient<E> }) => unknown
export type SyncContext = {
  id: string
  key: string
  event: ExternalEvent
  raw: unknown
  board: BoardClient
  client<E extends ProviderEvent>(event: E): SyncClient<E>
  apply(channel: string, overrides?: SyncOverrides): Promise<SyncResult>
}

export type ProviderMapping = {
  channel?: string
  run?: (context: SyncContext) => unknown
}

export type RenderInput = { message: Readonly<Message>; author: Readonly<Actor> | null; label: string; target: string }
export type EventMapping<E extends ProviderEvent> = string | SyncHandler<E> | { channel: string; run: SyncHandler<E> }

export type FileDelivery = { message: string; files: string[] }

/** What a linked message said, or why the platform wouldn't say. */
export type FetchedLink = Pick<Link, 'snapshot' | 'unavailable'>

export type ProviderFile = { data: Buffer; filename: string; mimeType?: string }
export type ProviderPost = { markdown: string; files?: ProviderFile[] }
export type ProviderDelivery = { thread: string; message: string; files?: string[] }
export type ProviderOptions = {
  platform: string
  canStartThreads?: boolean
  singleReaction?: boolean
  uploadsFiles?: boolean
  render?: (input: RenderInput) => string
}

export const ReceivedEvent = z.object({ event: ExternalEvent, raw: z.unknown(), dedupe: z.string().min(1) })
export type ReceivedEvent = z.infer<typeof ReceivedEvent>
export type Receive = (received: ReceivedEvent) => Promise<void>

export abstract class SyncProvider<E extends ProviderEvent = ProviderEvent> {
  readonly platform: string
  readonly canStartThreads: boolean
  readonly singleReaction: boolean
  readonly uploadsFiles: boolean
  readonly mappings: Record<string, ProviderMapping> = {}
  protected readonly options: ProviderOptions

  constructor(options: ProviderOptions) {
    this.options = options
    this.platform = options.platform
    this.canStartThreads = options.canStartThreads ?? false
    this.singleReaction = options.singleReaction ?? false
    this.uploadsFiles = options.uploadsFiles ?? false
  }

  abstract receive(key: string, request: Request, emit: Receive): Promise<Response>
  abstract resolveChannel(key: string): Promise<string>
  abstract resolveTarget(target: string): Promise<ResolvedTarget>
  abstract post(target: string, kind: ResolvedTarget['kind'], body: ProviderPost): Promise<ProviderDelivery>

  async findByEmail(_email: string): Promise<ExternalAuthor | null> { return null }
  mention(_actor: Actor): string | null { return null }
  async fetchRoot(_thread: string): Promise<SyncRoot | null> { return null }
  async fetchFile(_file: ExternalFile): Promise<Uint8Array | null> { return null }
  /** A linked message the platform didn't describe, read from the platform. */
  async fetchLink(_link: ExternalLink): Promise<FetchedLink> { return { snapshot: null, unavailable: `${this.platform} can't read it` } }
  async edit(_thread: string, _message: string, _body: ProviderPost): Promise<void> {}
  async delete(_thread: string, _message: string): Promise<void> {}
  async react(_thread: string, _message: string, _emoji: string, _added: boolean): Promise<void> {}
  async startTyping(_thread: string, _latest: string | null): Promise<void> {}
  async deleteFiles(_ids: string[]): Promise<void> {}
  refusesFiles(_error: unknown): boolean { return false }
  async uploadFiles(_thread: string, _files: ProviderFile[]): Promise<FileDelivery> {
    throw new Error(`${this.platform} does not support file uploads`)
  }

  abstract event(context: Pick<SyncContext, 'id' | 'key' | 'event' | 'raw'>): E

  sync(context: SyncContext, channel: string, overrides?: SyncOverrides): Promise<SyncResult> {
    return context.apply(channel, overrides)
  }

  render(input: RenderInput): string {
    return this.options.render?.(input) ?? `**${input.label}**: ${input.message.text}`
  }

  protected map(key: string, value: EventMapping<E>) {
    if (typeof value === 'string') {
      this.mappings[key] = { channel: value }
      return
    }
    const handler = typeof value === 'function' ? value : value.run
    this.mappings[key] = {
      ...(typeof value === 'object' ? { channel: value.channel } : {}),
      run: (context) => {
        const event = immutable(this.event(context))
        return handler({ event, board: context.client(event) })
      },
    }
  }
}
