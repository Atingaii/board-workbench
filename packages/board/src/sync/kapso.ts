import { ChatSyncProvider, type ChatInput } from './chat-provider.ts'
import type { Adapter, Message as ChatMessage } from 'chat'
import { markdownOf } from './chat.ts'
import { z } from 'zod'
import { envelope, eventSchema } from './events.ts'
import type { ResolvedTarget, SyncContext } from './provider.ts'
import { channels, type SyncFn, type SyncUnit } from './fn.ts'

type Raw = { kapso?: { transcript?: { text?: unknown } } } | null
type Sent = { responses?: { messages?: { id?: string }[] }[] } | null

// Kapso's thread IDs base64url-encode each part. The parts are phone number IDs,
// WhatsApp IDs (digits), and conversation IDs, so the board writes them as they are.
const decode = (id: string) => id.split(':').map((part) => Buffer.from(part, 'base64url').toString('utf8')).join(':')
const encode = (id: string) => id.split(':').map((part) => Buffer.from(part, 'utf8').toString('base64url')).join(':')

export const WhatsAppEvent = eventSchema('whatsapp', 'message')
export type WhatsAppEvent = z.infer<typeof WhatsAppEvent>

type MarkRead = (input: { phoneNumberId: string; messageId: string; typingIndicator: { type: 'text' } }) => Promise<unknown>
export type KapsoOptions = {
  adapter: Adapter
  markRead: MarkRead
}

/**
 * Syncs WhatsApp numbers on Kapso with the board: `sync` is what each event
 * does, both ways, like `numbers({ '16315558151': 'support' })`. Each Kapso
 * conversation is a thread. WhatsApp has no threads in a number, so a board
 * thread never starts one: a board root in a mirrored channel stays on the board.
 */
export function kapso(options: KapsoOptions, sync: SyncFn<WhatsAppEvent>): KapsoProvider {
  return new KapsoProvider(options, sync)
}

/**
 * Routes each event by its WhatsApp number. Keys are phone number IDs (`'16315558151'`), not
 * the numbers; values are a board channel to `mirror`, or a sync function.
 */
export const numbers = (map: Record<string, SyncUnit<WhatsAppEvent>>): SyncFn<WhatsAppEvent> => channels(map)

export class KapsoProvider extends ChatSyncProvider<WhatsAppEvent> {
  constructor(options: KapsoOptions, sync: SyncFn<WhatsAppEvent>) {
    if (typeof options.markRead !== 'function') throw new Error('kapso requires a public markRead operation for cross-instance read and typing')
    const fileIds = (raw: unknown) => ((raw as Sent)?.responses ?? []).flatMap((response) => response.messages?.[0]?.id ?? [])
    super({
      fileIds,
      platform: 'whatsapp',
      adapter: options.adapter,
      canStartThreads: false,
      // Each file goes as its own WhatsApp message: an image, video, audio, or document. WhatsApp can't delete them.
      async uploadFiles(thread, files) {
        const sent = await options.adapter.postMessage(thread, { markdown: '', files })
        return { message: sent.id, files: fileIds(sent.raw) }
      },
      // The adapter's answer for a file it can't send; WhatsApp's own refusals retry, then fail.
      refusesFiles: (error) => (error as { code?: string } | null)?.code === 'VALIDATION_ERROR',
      async resolveChannel(key) {
        if (!/^\d+$/.test(key)) throw new Error(`${key} isn't a phone number ID; use the number's ID from Kapso, not the number`)
        return key
      },
      fromChatId: decode,
      toChatId: encode,
      singleReaction: true,
      async startTyping(thread, latest) {
        if (!latest) return options.adapter.startTyping(thread)
        const [phoneNumberId] = decode(thread.slice(thread.indexOf(':') + 1)).split(':')
        await options.markRead({ phoneNumberId: phoneNumberId!, messageId: latest, typingIndicator: { type: 'text' } })
      },
      groupThread: (thread) => thread,
      isRoot: () => false,
      context: () => null,
      // Media comes over as attachments, through the adapter. A voice note may carry Kapso's transcript.
      markdown(message: ChatMessage) {
        const text = markdownOf(message)
        const transcript = (message.raw as Raw)?.kapso?.transcript?.text
        const heard = typeof transcript === 'string' && transcript.trim() && transcript !== text ? `> ${transcript.trim()}` : null
        return [text, heard].filter(Boolean).join('\n\n')
      },
      async resolveTarget(target): Promise<ResolvedTarget> {
        const parts = target.split(':')
        if (!/^\d+$/.test(parts[0]!) || (parts.length !== 1 && parts.length !== 3)) throw new Error(`invalid Kapso target: ${target}`)
        return { target, channel: parts[0]!, kind: parts.length === 1 ? 'channel' : 'thread' }
      },
    }, sync)
  }

  override eventId(key: string, input: ChatInput): string {
    if (input.kind !== 'reaction') return super.eventId(key, input)
    const reaction = input.reaction
    const stamp = z.looseObject({ id: z.string().min(1) }).parse(reaction.raw).id
    return `reaction:${key}:${this.toNative(reaction.threadId)}|${reaction.messageId}|${reaction.rawEmoji}|${reaction.user.userId}|${reaction.added}|${stamp}`
  }

  override event(context: SyncContext): WhatsAppEvent {
    return WhatsAppEvent.parse(envelope(this.platform, context.key, context.event, context.raw, context.id))
  }
}
