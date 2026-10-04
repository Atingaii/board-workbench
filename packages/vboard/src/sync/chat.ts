import { Chat, stringifyMarkdown, type Adapter, type Message } from 'chat'
import { ephemeralState } from './state.ts'

/**
 * One Chat SDK instance per sync entry. Platform modules call this, so
 * the board (`vboard`) never loads Chat SDK unless sync is configured.
 */
export const createChat = (adapter: Adapter): Chat =>
  new Chat({
    userName: 'vboard',
    adapters: { [adapter.name]: adapter },
    state: ephemeralState(),
    // The default, `drop`, would lose a message that arrives while another is handled.
    concurrency: 'concurrent',
    logger: 'warn',
  })

/** A message as markdown, the board's text format: Chat SDK parses every platform's own. */
export function markdownOf(message: Message): string {
  try {
    return stringifyMarkdown(message.formatted).trim() || message.text
  } catch {
    return message.text
  }
}
