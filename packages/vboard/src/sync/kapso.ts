import type { Adapter, Message as ChatMessage } from 'chat'
import type { BoardClient } from '../client/client.ts'
import type { ExternalAuthor, ExternalEvent } from '../contract/contract.ts'
import { createChat, markdownOf } from './chat.ts'
import type { SyncPlatform } from './types.ts'

/** What a Kapso inbound function receives for each message in a conversation the board hasn't synced yet. */
export type KapsoMessage = {
  /** The WhatsApp message ID (`wamid.…`). */
  id: string
  text: string
  author: ExternalAuthor
  /** `kapso:<phone number ID>`, the business number it was sent to. */
  channel: string
  /** `kapso:<phone number ID>:<WhatsApp ID>:<conversation ID>`. Pass it as `sync` to join this conversation. */
  thread: string
  raw: unknown
}

export type KapsoHandler = (args: { message: KapsoMessage; board: BoardClient }) => unknown

type Raw = { kapso?: { transcript?: { text?: unknown } } } | null

// Kapso's thread IDs base64url-encode each part. The parts are phone number IDs,
// WhatsApp IDs (digits), and conversation IDs, so the board writes them as they are.
const decode = (id: string) => id.split(':').map((part) => Buffer.from(part, 'base64url').toString('utf8')).join(':')
const encode = (id: string) => id.split(':').map((part) => Buffer.from(part, 'utf8').toString('base64url')).join(':')

/**
 * Syncs WhatsApp numbers on Kapso with board channels. Keys are phone number
 * IDs (`'16315558151'`); values are a board channel (a two-way mirror) or a
 * function that handles new conversations itself. Each Kapso conversation is a
 * thread. WhatsApp has no threads in a number, so a board thread never starts
 * one: a board root in a mirrored channel stays on the board.
 */
export function kapso(options: {
  adapter: Adapter
  numbers: Record<string, string | KapsoHandler>
}): SyncPlatform {
  return {
    platform: 'whatsapp',
    adapter: options.adapter,
    createChat: () => createChat(options.adapter),
    canStartThreads: false,
    mappings: options.numbers,
    async resolveChannel(key) {
      if (!/^\d+$/.test(key)) throw new Error(`${key} isn't a phone number ID; use the number's ID from Kapso, not the number`)
      return key
    },
    fromChatId: decode,
    toChatId: encode,
    singleReaction: true,
    groupThread: (thread) => thread,
    isRoot: () => false,
    context: () => null,
    // Media arrives as attachments, linked when Kapso mirrored them; voice notes may carry a transcript.
    markdown(message: ChatMessage) {
      const text = markdownOf(message)
      const transcript = (message.raw as Raw)?.kapso?.transcript?.text
      const files = message.attachments.map((file) => {
        const name = file.name ?? file.type
        return file.url ? `[${name}](${file.url})` : `(${name})`
      })
      const heard = typeof transcript === 'string' && transcript.trim() && transcript !== text ? `> ${transcript.trim()}` : null
      return [text, heard, ...files].filter(Boolean).join('\n\n')
    },
    handlerArgs(event: ExternalEvent, raw, board) {
      if (event.kind !== 'message') return { message: null, board }
      const message: KapsoMessage = {
        id: event.message,
        text: event.text,
        author: event.author,
        channel: event.channel,
        thread: event.thread,
        raw,
      }
      return { message, board }
    },
  }
}
