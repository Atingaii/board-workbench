import { Chat, type Adapter } from 'chat'
import { ephemeralState } from './state.ts'

/**
 * One Chat SDK instance per sync entry. Platform modules call this, so
 * `just-board/server` never loads Chat SDK unless sync is configured.
 */
export const createChat = (adapter: Adapter): Chat =>
  new Chat({
    userName: 'just-board',
    adapters: { [adapter.name]: adapter },
    state: ephemeralState(),
    // The default, `drop`, would lose a message that arrives while another is handled.
    concurrency: 'concurrent',
    logger: 'warn',
  })
