import type { Adapter } from 'chat'
import type { BoardClient } from '../client/client.ts'
import type { ExternalAuthor, ExternalEvent } from '../contract/contract.ts'
import { createChat } from './chat.ts'
import type { SyncPlatform } from './types.ts'

/** What a Slack inbound function receives for each message in a thread the board hasn't synced yet. */
export type SlackMessage = {
  /** The Slack message ID (its `ts`). */
  id: string
  text: string
  author: ExternalAuthor
  /** `slack:C0123ABC`, as a sync target. */
  channel: string
  /** `slack:C0123ABC:1727.1234`. Pass it as `sync` to join this Slack thread. */
  thread: string
  raw: unknown
}

export type SlackHandler = (args: { message: SlackMessage; board: BoardClient }) => unknown

type SlackClient = {
  conversations: {
    list(args: Record<string, unknown>): Promise<{
      channels?: { id?: string; name?: string }[]
      response_metadata?: { next_cursor?: string }
    }>
  }
}

/**
 * Syncs Slack channels with board channels. Keys are channels by name
 * (`'#prs'`) or ID (`'C0123ABC'`); values are a board channel (a two-way
 * mirror) or a function that handles new threads itself.
 */
export function slack(options: {
  adapter: Adapter
  channels: Record<string, string | SlackHandler>
}): SyncPlatform {
  const names = new Map<string, Promise<string>>()

  async function lookup(name: string): Promise<string> {
    const client = (options.adapter as unknown as { webClient?: SlackClient }).webClient
    if (!client) throw new Error(`can't resolve Slack channel #${name}: use its ID instead`)
    let cursor: string | undefined
    do {
      const page = await client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      })
      const found = page.channels?.find((channel) => channel.name === name)
      if (found?.id) return found.id
      cursor = page.response_metadata?.next_cursor || undefined
    } while (cursor)
    throw new Error(`no Slack channel named #${name}, or the bot isn't in it`)
  }

  return {
    platform: 'slack',
    adapter: options.adapter,
    createChat: () => createChat(options.adapter),
    canStartThreads: true,
    mappings: options.channels,
    // `#name` is looked up by name; anything else is a channel ID.
    resolveChannel(key) {
      if (!key.startsWith('#')) return Promise.resolve(key)
      const value = key.slice(1)
      let promise = names.get(value)
      if (!promise) {
        promise = lookup(value)
        promise.catch(() => names.delete(value))
        names.set(value, promise)
      }
      return promise
    },
    groupThread: (thread) => thread,
    // A Slack thread is named by its root message's ts.
    isRoot: (thread, messageId) => thread.slice(thread.lastIndexOf(':') + 1) === messageId,
    context: () => null,
    handlerArgs(event: ExternalEvent, raw, board) {
      if (event.kind !== 'message') return { message: null, board }
      const message: SlackMessage = {
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
