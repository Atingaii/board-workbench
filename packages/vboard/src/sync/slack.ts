import { ChatSyncProvider, type ChatInput } from './chat-provider.ts'
import type { Adapter, Message as ChatMessage } from 'chat'
import { markdownOf } from './chat.ts'
import { z } from 'zod'
import { envelope, eventSchema } from './events.ts'
import type { ResolvedTarget, SyncContext, SyncHandler, EventMapping, RenderInput } from './provider.ts'

type SlackChannel = { id?: string; name?: string; is_member?: boolean; is_private?: boolean }
export type SlackClient = {
  conversations: {
    list(args: Record<string, unknown>): Promise<{
      channels?: SlackChannel[]
      response_metadata?: { next_cursor?: string }
    }>
    info(args: { channel: string }): Promise<{ channel?: SlackChannel }>
    join(args: { channel: string }): Promise<unknown>
  }
  users?: {
    info(args: { user: string }): Promise<{ user?: { profile?: { image_72?: string; image_48?: string } } }>
    lookupByEmail?(args: { email: string }): Promise<{ user?: SlackUser }>
  }
  files?: { delete(args: { file: string }): Promise<unknown> }
}

type SlackUser = {
  id?: string
  name?: string
  real_name?: string
  is_bot?: boolean
  profile?: { display_name?: string; real_name?: string; image_72?: string; image_48?: string }
}

/** Slack's answers that mean "no files from this app", not "try again". */
const REFUSED = new Set([
  'missing_scope',
  'not_allowed_token_type',
  'no_permission',
  'restricted_action',
  'file_uploads_disabled',
  'file_uploads_except_images_disabled',
  'file_upload_size_restricted',
])

/** A Slack API error's code (`missing_scope`), with the scope it needed. */
function slackError(error: unknown): string {
  const data = (error as { data?: { error?: string; needed?: string } }).data
  if (!data?.error) return (error as Error).message
  return data.needed ? `${data.error}, needs ${data.needed}` : data.error
}

export const SlackEvent = eventSchema('slack', 'message')
export type SlackEvent = z.infer<typeof SlackEvent>

export type SlackHandler = SyncHandler<SlackEvent>
export type SlackOptions = {
  adapter: Adapter
  render?: (input: RenderInput) => string
  client?: () => Promise<SlackClient>
  channels: Record<string, EventMapping<SlackEvent>>
}

/**
 * Syncs Slack channels with board channels. Keys are channels by name
 * (`'#prs'`) or ID (`'C0123ABC'`); values are a board channel (a two-way
 * mirror) or a callback that handles every incoming event. The app joins public
 * channels it isn't in; private ones need an invite.
 */
export function slack(options: SlackOptions): SlackProvider {
  return new SlackProvider(options)
}

export class SlackProvider extends ChatSyncProvider<SlackEvent> {
  constructor(options: SlackOptions) {
    let directClient: SlackClient | undefined
    if (!options.client) {
      try {
        directClient = (options.adapter as Adapter & { webClient?: SlackClient }).webClient
      } catch {
        throw new Error('slack requires a public client resolver when the adapter uses async tokens')
      }
    }
    async function client(): Promise<SlackClient | undefined> {
      return options.client ? options.client() : directClient
    }

    // One listing resolves every name. A miss lists again, since the channel may be
    // new (the sync engine throttles retries). Without `groups:read`, Slack refuses
    // to list private channels at all, so the listing falls back to public ones.
    let listing: Promise<SlackChannel[]> | undefined
    let publicOnly = false
    async function list(client: SlackClient, types: string): Promise<SlackChannel[]> {
      const channels: SlackChannel[] = []
      let cursor: string | undefined
      do {
        const page = await client.conversations.list({
          types,
          exclude_archived: true,
          limit: 1000,
          ...(cursor ? { cursor } : {}),
        })
        channels.push(...(page.channels ?? []))
        cursor = page.response_metadata?.next_cursor || undefined
      } while (cursor)
      return channels
    }
    async function listAll(client: SlackClient): Promise<SlackChannel[]> {
      if (!publicOnly)
        try {
          return await list(client, 'public_channel,private_channel')
        } catch (error) {
          if (!slackError(error).startsWith('missing_scope')) throw error
          publicOnly = true
        }
      return list(client, 'public_channel')
    }
    function channels(client: SlackClient, fresh: boolean) {
      if (fresh || !listing) {
        const promise = listAll(client)
        promise.catch(() => {
          if (listing === promise) listing = undefined
        })
        listing = promise
      }
      return listing
    }

    async function find(client: SlackClient, name: string): Promise<SlackChannel & { id: string }> {
      const match = (all: SlackChannel[]) =>
        all.find((channel): channel is SlackChannel & { id: string } => channel.name === name && !!channel.id)
      let found
      try {
        found = match(await channels(client, false)) ?? match(await channels(client, true))
      } catch (error) {
        throw new Error(`can't list Slack channels to find #${name} (${slackError(error)}); use its ID instead`)
      }
      if (!found)
        throw new Error(
          publicOnly
            ? `no public Slack channel named #${name} (the app lacks groups:read, so a private channel needs its ID)`
            : `no Slack channel named #${name} (a private channel shows up once the app is invited)`,
        )
      return found
    }

    // Slack only sends a channel's events to apps in it. Never throws: a channel the
    // app can't join still resolves, and the log says who to invite.
    const joined = new Map<string, Promise<void>>()
    function join(client: SlackClient, id: string, known?: SlackChannel) {
      let promise = joined.get(id)
      if (!promise) {
        promise = (async () => {
          const channel = known ?? (await client.conversations.info({ channel: id }).then((r) => r.channel, () => undefined))
          if (!channel || channel.is_member) return
          const label = channel.name ? `#${channel.name}` : id
          if (channel.is_private)
            return console.warn(`[vboard] slack: invite the app to ${label}; it can't join private channels itself`)
          try {
            await client.conversations.join({ channel: id })
          } catch (error) {
            joined.delete(id)
            console.warn(`[vboard] slack: couldn't join ${label} (${slackError(error)}); invite the app to it`)
          }
        })()
        joined.set(id, promise)
      }
      return promise
    }

    // Slack's events carry user IDs only; their pictures come from users.info, once each.
    const avatars = new Map<string, Promise<string | null>>()
    function avatarOf(user: string): Promise<string | null> {
      let promise = avatars.get(user)
      if (!promise) {
        promise = client()
          .then(async (web) => {
            const profile = (await web?.users?.info({ user }))?.user?.profile
            return profile?.image_72 ?? profile?.image_48 ?? null
          })
          .catch(() => null)
        avatars.set(user, promise)
      }
      return promise
    }

    const fileIds = (raw: unknown) => ((raw as { uploadedFileIds?: string[] } | null)?.uploadedFileIds ?? []).filter(Boolean)
    // Slack tags each file with its event's team, and the adapter fetches a tagged
    // file with that team's installed token, which a single-workspace app (one bot
    // token, as Vercel Connect gives it) never stores: "Installation not found".
    // Without the tag, the adapter uses its bot token.
    // An app that can also install through OAuth (a client ID) keeps the tag, so
    // each team's files use that team's token.
    const internals = options.adapter as Adapter & { defaultBotTokenProvider?: unknown; installationProvider?: unknown; clientId?: unknown }
    const singleWorkspace = !!internals.defaultBotTokenProvider && !internals.installationProvider && !internals.clientId
    super({
      fileIds,
      fileToFetch(file) {
        if (!singleWorkspace || !file.fetchMetadata) return file
        const { teamId: _team, enterpriseId: _enterprise, isEnterpriseInstall: _install, ...rest } = file.fetchMetadata
        return { ...file, fetchMetadata: rest }
      },
      render: options.render,
      platform: 'slack',
      adapter: options.adapter,
      canStartThreads: true,
      // The adapter uploads files given without text as their own message: here, right after the text.
      async uploadFiles(thread, files) {
        const sent = await options.adapter.postMessage(thread, { markdown: '', files })
        return { message: sent.id, files: fileIds(sent.raw) }
      },
      refusesFiles: (error) => REFUSED.has((error as { data?: { error?: string } } | null)?.data?.error ?? ''),
      async deleteFiles(ids) {
        const web = await client()
        for (const file of ids)
          await web?.files?.delete({ file }).catch((error: unknown) => console.warn(`[vboard] slack: couldn't delete file ${file} (${slackError(error)})`))
      },
      async findByEmail(email) {
        const web = await client()
        const user = (await web?.users?.lookupByEmail?.({ email }).catch(() => undefined))?.user
        if (!user?.id) return null
        const handle = user.profile?.display_name || user.name || user.id
        return {
          id: `slack:user:${user.id}`, handle,
          name: user.profile?.real_name || user.real_name || handle,
          avatar: user.profile?.image_72 ?? user.profile?.image_48 ?? null,
          isBot: user.is_bot === true,
        }
      },
      mention: (actor) => actor.id.startsWith('slack:user:') ? `<@${actor.id.slice('slack:user:'.length)}>` : null,
      // `#name` is looked up by name; anything else is a channel ID.
      async resolveChannel(key) {
        if (!key.startsWith('#')) {
          const web = await client().catch(() => undefined)
          if (web) await join(web, key)
          return key
        }
        const web = await client()
        if (!web) throw new Error(`can't look up Slack channel ${key}: use its ID instead`)
        const channel = await find(web, key.slice(1))
        await join(web, channel.id, channel)
        return channel.id
      },
      markdown: markdownOf,
      avatar: (message: ChatMessage) => (message.author.userId ? avatarOf(message.author.userId) : Promise.resolve(null)),
      groupThread: (thread) => thread,
      // A Slack thread is named by its root message's ts.
      isRoot: (thread, messageId) => thread.slice(thread.lastIndexOf(':') + 1) === messageId,
      context: () => null,
      async resolveTarget(target): Promise<ResolvedTarget> {
        const at = target.indexOf(':')
        const channel = await this.resolveChannel(at === -1 ? target : target.slice(0, at))
        return { target: at === -1 ? channel : `${channel}:${target.slice(at + 1)}`, channel, kind: at === -1 ? 'channel' : 'thread' }
      },
    })
    for (const [key, value] of Object.entries(options.channels)) this.map(key, value)
  }

  override eventId(key: string, input: ChatInput): string {
    if (input.kind !== 'reaction') return super.eventId(key, input)
    const reaction = input.reaction
    const stamp = z.looseObject({ event_ts: z.string().min(1) }).parse(reaction.raw).event_ts
    return `reaction:${key}:${this.toNative(reaction.threadId)}|${reaction.messageId}|${reaction.rawEmoji}|${reaction.user.userId}|${reaction.added}|${stamp}`
  }

  override event(context: Pick<SyncContext, 'id' | 'key' | 'event' | 'raw'>): SlackEvent {
    return SlackEvent.parse(envelope(this.platform, context.key, context.event, context.raw, context.id))
  }
}
