import { ChatSyncProvider, type ChatInput } from './chat-provider.ts'
import type { Adapter, Message as ChatMessage } from 'chat'
import type { ExternalAuthor } from '../contract/external.ts'
import { markdownOf } from './chat.ts'
import { z } from 'zod'
import { envelope, eventSchema } from './events.ts'
import { UnreadableError, type ProviderDelivery, type ProviderPost, type ReceivedEvent, type ResolvedTarget, type SyncContext } from './provider.ts'
import { createLinearAdapter } from '@chat-adapter/linear'
import { connectLinearAdapter } from '@vercel/connect/chat'
import { channels, type SyncFn, type SyncUnit } from './fn.ts'

export const LinearEvent = eventSchema('linear', 'comment')
export type LinearEvent = z.infer<typeof LinearEvent>

export type LinearOptions = {
  /**
   * A Vercel Connect connector (`'linear/acme'`) holding a Linear app's token: board builds the
   * Chat SDK adapter from it. Or your own adapter from `createLinearAdapter`, in its default
   * `comments` mode.
   */
  adapter: Adapter | string
}

/**
 * Syncs Linear with the board: `app` is a Vercel Connect connector (`'linear/acme'`) or the
 * options, and `sync` is what each event does, both ways, like `teams({ ENG: 'dev' })`. Each
 * issue is a thread: its comments are replies, and a board root in a mirrored team opens an issue.
 */
export function linear(app: string | LinearOptions, sync: SyncFn<LinearEvent>): LinearProvider {
  return new LinearProvider(typeof app === 'string' ? { adapter: app } : app, sync)
}

/**
 * Routes each event by its Linear team. Keys are team keys (`'ENG'`, the prefix of `ENG-123`);
 * values are a board channel to `mirror`, or a sync function.
 */
export const teams = (map: Record<string, SyncUnit<LinearEvent>>): SyncFn<LinearEvent> => channels(map)

type User = { id?: string; name?: string; displayName?: string; url?: string; avatarUrl?: string | null; type?: string }

/** A person's handle, the end of their profile URL (`…/profiles/ada`), as the adapter reads it. */
const handleOf = (user: User | undefined) => /\/profiles\/([^/?#]+)/.exec(user?.url ?? '')?.[1] ?? user?.displayName ?? user?.name

const author = (user: User | undefined, isBot = false): ExternalAuthor => ({
  id: `linear:user:${user?.id ?? 'unknown'}`,
  handle: handleOf(user) ?? 'unknown',
  name: user?.name ?? user?.displayName ?? 'unknown',
  avatar: user?.avatarUrl ?? null,
  isBot: isBot || user?.type === 'bot' || user?.type === 'app',
})

/** `ENG` from `ENG-123`, or from a Linear URL that names an issue (`…/issue/ENG-123/…`). */
const teamOf = (identifierOrUrl: string | undefined | null) => /(?:^|\/issue\/)([A-Z0-9_]+)-\d+/i.exec(identifierOrUrl ?? '')?.[1]?.toUpperCase() ?? null

type CommentData = { id: string; body?: string; issueId?: string; parentId?: string | null; user?: User; issue?: { id?: string; identifier?: string } }
type CommentPayload = { type: 'Comment'; action: string; url?: string; data: CommentData; organizationId: string }
type IssueData = {
  id: string; identifier: string; title: string; url?: string; teamId?: string
  team?: { key?: string }; state?: { name?: string; type?: string }
}
type IssuePayload = {
  type: 'Issue'; action: string; url?: string; data: IssueData
  updatedFrom?: { stateId?: unknown; title?: unknown }; actor?: User; webhookId?: string; webhookTimestamp?: number
}
type LinearRaw = { kind?: string; comment?: { url?: string; issueId?: string; parentId?: string; id?: string; body?: string; user?: { avatarUrl?: string } } }

/** The adapter's own parsing, so an edit lands on the same IDs as the comment it changes. */
type CommentParser = {
  parseMessage(raw: { kind: 'comment'; comment: Record<string, unknown>; organizationId: string }): ChatMessage
}

type Issue = {
  id: string; identifier: string; title: string; url: string
  state?: Promise<{ name?: string; type?: string } | undefined>
  team?: Promise<{ key?: string } | undefined>
  creator?: Promise<User | undefined>
}
type LinearClient = {
  teams(args: { filter: { key: { eq: string } } }): Promise<{ nodes: { id: string; key: string }[] }>
  issue(id: string): Promise<Issue>
  createIssue(input: { teamId: string; title: string; description: string }): Promise<{ issueId?: string }>
  updateIssue(id: string, input: { description: string }): Promise<unknown>
}

/** An issue's root on the board: its copy is the issue itself, not a comment. */
const ROOT = 'issue'
/** A root's copy: one the board opened (`issue`), or imported (`lifecycle:<event>`, `root:<event>`). Comment IDs are UUIDs. */
const isIssue = (message: string) => message === ROOT || message.includes(':')

/** `ENG:<issueId>` or `ENG:<issueId>:c:<commentId>` (a comment thread). */
function parseThread(thread: string) {
  const match = /^([^:]+):([^:]+)(?::c:([^:]+))?$/.exec(thread)
  if (!match) throw new Error(`invalid Linear thread: ${thread}`)
  return { team: match[1]!, issue: match[2]!, comment: match[3] ?? null }
}

/** A board message's first line, as an issue title: Linear titles are plain text. */
function titleOf(markdown: string) {
  const line = markdown.split('\n').map((text) => text.trim()).find(Boolean) ?? 'Untitled'
  return line.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 255) || 'Untitled'
}

function stateOf(state: { name?: string; type?: string } | undefined) {
  return state?.type ?? state?.name?.toLowerCase() ?? null
}

export class LinearProvider extends ChatSyncProvider<LinearEvent> {
  private readonly adapter: Adapter
  private readonly teamIds = new Map<string, string>()

  constructor(given: LinearOptions, sync: SyncFn<LinearEvent>) {
    const adapter = typeof given.adapter === 'string'
      ? (createLinearAdapter({ ...connectLinearAdapter(given.adapter), mode: 'comments' }) as unknown as Adapter)
      : given.adapter
    super({
      platform: 'linear',
      adapter,
      canStartThreads: true,
      // Checked against Linear in the class's own `resolveChannel`, which can reach its API.
      resolveChannel: (key) => Promise.resolve(key.toUpperCase()),
      // A comment thread (`ENG:<issue>:c:<comment>`) belongs to its issue (`ENG:<issue>`).
      groupThread: (thread) => thread.replace(/:c:[^:]+$/, ''),
      channelOf: (thread) => thread.slice(0, thread.indexOf(':')),
      // The board's IDs carry the team, which Chat SDK's don't: `ENG:<issue>` is `<issue>` there.
      toChatId: (id) => id.slice(id.indexOf(':') + 1),
      isRoot: () => false,
      context: () => null,
      // Linear's own markdown; Chat SDK's text flattens it.
      markdown(message: ChatMessage) {
        const body = (message.raw as LinearRaw | null)?.comment?.body
        return typeof body === 'string' && body.trim() ? body.trim() : markdownOf(message)
      },
      async avatar(message: ChatMessage) {
        return (message.raw as LinearRaw | null)?.comment?.user?.avatarUrl ?? null
      },
      // The adapter only emits new comments: edits and deletes come through here.
      missed(_headers, body) {
        let payload: CommentPayload
        try {
          payload = JSON.parse(body) as CommentPayload
        } catch {
          return []
        }
        if (payload.type !== 'Comment' || (payload.action !== 'update' && payload.action !== 'remove')) return []
        const { data } = payload
        const issueId = data.issueId ?? data.issue?.id
        if (!issueId || !data.user) return []
        const message = (adapter as unknown as CommentParser).parseMessage({
          kind: 'comment',
          organizationId: payload.organizationId,
          comment: {
            ...data, issueId, parentId: data.parentId ?? undefined, url: payload.url,
            user: { type: 'user', id: data.user.id, displayName: handleOf(data.user) ?? 'unknown', fullName: data.user.name ?? 'unknown', email: undefined, avatarUrl: data.user.avatarUrl ?? undefined },
          },
        })
        // The board's own comments: it made the change, so it already has it.
        if (message.author.isMe) return []
        return payload.action === 'update'
          ? [{ kind: 'edited', message }]
          : [{ kind: 'deleted', thread: message.threadId, message: message.id, raw: payload }]
      },
      intercept(key, headers, body): ReceivedEvent[] {
        let payload: IssuePayload
        try {
          payload = JSON.parse(body) as IssuePayload
        } catch {
          return []
        }
        if (payload.type !== 'Issue' || !payload.data?.identifier) return []
        const { data } = payload
        const created = payload.action === 'create'
        const moved = payload.action === 'update' && payload.updatedFrom?.stateId !== undefined
        const retitled = payload.action === 'update' && payload.updatedFrom?.title !== undefined
        if (!created && !moved && !retitled) return []
        const team = data.team?.key ?? teamOf(data.identifier)!
        const state = stateOf(data.state)
        const delivery = headers.get('linear-delivery') ?? `${payload.webhookId}:${payload.webhookTimestamp}`
        return [{
          event: {
            kind: 'lifecycle',
            channel: `${key}:${team}`,
            thread: `${key}:${team}:${data.id}`,
            type: created ? 'issue.created' : 'issue.updated',
            title: `${data.identifier}: ${data.title}`,
            url: data.url ?? payload.url ?? null,
            labels: { ...(created ? { issue: data.identifier } : {}), ...(state && (created || moved) ? { state } : {}) },
            unset: [],
            reply: null,
            createRoot: created,
            ...(retitled ? { retitled: true } : {}),
            author: author(payload.actor),
          },
          raw: payload,
          dedupe: `lifecycle:${delivery}`,
        }]
      },
      async resolveTarget(target): Promise<ResolvedTarget> {
        if (/^[A-Z0-9_]+:[^:]+:c:[^:]+$/i.test(target)) throw new Error(`a comment thread can't be a target; sync its issue, ${target.replace(/:c:[^:]+$/, '')}`)
        if (!/^[A-Z0-9_]+(?::[^:]+)?$/i.test(target)) throw new Error(`invalid Linear target: ${target}`)
        const at = target.indexOf(':')
        return { target, channel: (at === -1 ? target : target.slice(0, at)).toUpperCase(), kind: at === -1 ? 'channel' : 'thread' }
      },
    }, sync)
    this.adapter = adapter
  }

  override async resolveChannel(key: string) {
    await this.team(key)
    return key.toUpperCase()
  }

  override async fetchRoot(thread: string) {
    await this.ready()
    const issue = await this.client().issue(parseThread(thread).issue)
    const [state, creator] = await Promise.all([issue.state, issue.creator])
    const found = stateOf(state)
    return {
      text: `${issue.identifier}: ${issue.title}\n${issue.url}`,
      raw: { issue: { id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url } },
      author: author(creator),
      labels: { issue: issue.identifier, ...(found ? { state: found } : {}) },
    }
  }

  private client() {
    return (this.adapter as unknown as { linearClient: LinearClient }).linearClient
  }

  /** A team's ID from its key, which Linear's API asks for to open an issue. */
  private async team(key: string): Promise<string> {
    const wanted = key.toUpperCase()
    const known = this.teamIds.get(wanted)
    if (known) return known
    await this.ready()
    const { nodes } = await this.client().teams({ filter: { key: { eq: wanted } } })
    const team = nodes.find((node) => node.key.toUpperCase() === wanted)
    if (!team) throw new UnreadableError('channel_not_found', `no Linear team ${wanted}`)
    this.teamIds.set(wanted, team.id)
    return team.id
  }

  // Inbound IDs carry the comment's team, from its URL, or Linear's API when the URL doesn't say.
  protected override async normalize(key: string, input: ChatInput): Promise<ReceivedEvent> {
    const received = await super.normalize(key, input)
    if (input.kind === 'reaction') return received
    const raw = (input.kind === 'deleted' ? input.raw : input.message.raw) as (LinearRaw & CommentPayload) | null
    const comment = raw?.comment ?? raw?.data
    const issue = comment?.issueId ?? raw?.data?.issue?.id
    const root = (comment as { parentId?: string } | undefined)?.parentId || comment?.id
    if (!issue || !root) return received
    const team = teamOf(raw?.comment?.url ?? raw?.url) ?? teamOf(raw?.data?.issue?.identifier) ?? await this.teamOfIssue(issue)
    const thread = `${key}:${team}:${issue}`
    const event = { ...received.event, channel: `${key}:${team}`, thread, subthread: `${thread}:c:${root}` }
    return { ...received, event } as ReceivedEvent
  }

  private async teamOfIssue(id: string) {
    await this.ready()
    const issue = await this.client().issue(id)
    return (await issue.team)?.key ?? teamOf(issue.identifier) ?? 'UNKNOWN'
  }

  override inboxChannel(key: string, thread: string): string {
    const native = thread.slice(key.length + 1)
    return `${key}:${native.slice(0, native.indexOf(':'))}`
  }

  /** A root in a mirrored team opens an issue, titled with its first line; a reply is a comment. */
  override async post(target: string, kind: ResolvedTarget['kind'], post: ProviderPost): Promise<ProviderDelivery> {
    if (kind === 'thread') {
      const sent = await super.post(target, kind, post)
      return { ...sent, thread: target }
    }
    const teamId = await this.team(target)
    const created = await this.client().createIssue({ teamId, title: titleOf(post.markdown), description: post.markdown })
    if (!created.issueId) throw new Error(`Linear didn't return the issue it opened in ${target}`)
    return { thread: `${target.toUpperCase()}:${created.issueId}`, message: ROOT }
  }

  override async edit(thread: string, message: string, post: ProviderPost) {
    if (!isIssue(message)) return super.edit(thread, message, post)
    await this.ready()
    await this.client().updateIssue(parseThread(thread).issue, { description: post.markdown })
  }

  // An issue opened from the board stays when its root is deleted there: closing it is a person's call.
  override async delete(thread: string, message: string) {
    if (!isIssue(message)) await super.delete(thread, message)
  }

  // Linear reacts to comments, not to issues.
  override async react(thread: string, message: string, emoji: string, added: boolean) {
    if (!isIssue(message)) await super.react(thread, message, emoji, added)
  }

  override event(context: SyncContext): LinearEvent {
    return LinearEvent.parse(envelope(this.platform, context.key, context.event, context.raw ?? {}, context.id))
  }
}
