import { z } from 'zod'
import {
  AttachmentId,
  ATTACHMENTS_PER_MESSAGE_MAX,
  ChannelPath,
  Emoji,
  LabelKey,
  Labels,
  MESSAGE_TEXT_MAX,
  MessageId,
  MessageText,
} from '../contract/schemas.ts'
import type { BoardEvent } from '../contract/contract.ts'
import type { Actor, Channel, Message } from '../contract/reducers.ts'

const id = z.coerce.number().int().positive()
const repeated = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]))

/**
 * `pr` → `['pr', null]` (has the label), `status=open` → `['status', ['open']]`,
 * `state=open|draft` → either value.
 */
const LabelFilter = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_.-]*(=.*)?$/, 'label filters look like key, key=value, or key=a|b')
  .transform((value) => {
    const at = value.indexOf('=')
    return at === -1 ? ([value, null] as const) : ([value.slice(0, at), value.slice(at + 1).split('|')] as const)
  })

/** Shared by `/messages` and `/events`. */
export const Filters = z.object({
  channel: z.string().optional(),
  re: id.optional(),
  by: z.string().optional(),
  mentions: z.string().optional(),
  label: repeated.pipe(z.array(LabelFilter)).optional(),
  /** Where messages came from: a sync key such as `slack`, or `board` for the board itself. */
  from: z.string().min(1).max(64).optional(),
  /** Case-insensitive words the text contains. */
  text: z.string().min(1).max(200).optional(),
})

export const MessagesQuery = Filters.extend({
  after: z.coerce.number().int().nonnegative().optional(),
  before: id.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export const EventsQuery = Filters.extend({
  after: z.coerce.number().int().nonnegative().optional(),
  wait: z.coerce.number().min(0).max(300).optional(),
  all: z.coerce.boolean().optional(),
})

export const PostBody = z
  .object({
    channel: ChannelPath.optional(),
    re: MessageId.optional(),
    /** May be empty when the message has attachments. */
    text: z.string().max(MESSAGE_TEXT_MAX).default(''),
    labels: Labels.optional(),
    noSync: z.boolean().optional(),
    /** External targets a new thread starts with: `slack:#incidents`, `github:owner/repo:12`. */
    sync: z.array(z.string().min(3).max(300)).max(10).optional(),
    id: z.string().min(1).max(200).optional(),
    /** IDs from `POST /attachments`. */
    attachments: z.array(AttachmentId).max(ATTACHMENTS_PER_MESSAGE_MAX).optional(),
  })
  .refine((body) => body.text.trim().length > 0 || (body.attachments?.length ?? 0) > 0, {
    message: 'message text is empty',
    path: ['text'],
  })
  .refine((body) => (body.channel === undefined) !== (body.re === undefined), {
    message: 'a post needs `channel`; a reply needs `re`',
  })
  .refine((body) => !(body.noSync && body.sync?.length), {
    message: '`noSync` and `sync` contradict each other',
  })

export const SyncBody = z.object({ target: z.string().min(3).max(300) })
export const InboxQuery = z.object({
  channel: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export const IdentityLinkBody = z.object({
  /** The sync entry whose account to link, e.g. `slack`. */
  sync: z.string().min(1).max(64),
  /** `code` even when the entry can sign people in. */
  method: z.enum(['code', 'consent']).optional(),
})
export const IdentityCheckBody = z.object({ sync: z.string().min(1).max(64) })
export const IdentityUnlinkBody = z.object({ actor: z.string().min(1).max(256) })

export const EditBody = z.object({ text: MessageText })
export const DeleteBody = z.object({}).optional()
export const TypingBody = z.object({}).optional()
export const ReactBody = z.object({ emoji: Emoji, remove: z.boolean().optional() })
export const LabelBody = z
  .object({ set: Labels.optional(), unset: z.array(LabelKey).optional() })
  .refine((body) => body.set !== undefined || body.unset !== undefined, {
    message: 'nothing to change: pass `set` or `unset`',
  })

export type FiltersInput = z.input<typeof Filters>
export type MessagesQueryInput = z.input<typeof MessagesQuery>
export type EventsQueryInput = z.input<typeof EventsQuery>
export type PostInput = z.input<typeof PostBody>

/** The person a platform account is linked to (`actor.linked`). */
export type PersonView = { id: string; handle: string; name: string; avatar: string | null }

/**
 * `kind` says who wrote it: a `person` or a platform user (`external`), an agent (`profile`), or a deployment or workflow.
 * `person` is who a linked platform account belongs to.
 */
export type ActorView = Pick<Actor, 'kind' | 'handle' | 'name' | 'avatar'> & { person?: PersonView }
export type MessageView = Message & { author: ActorView | null }

/** A board event as subscribers get it. Checking `type` narrows `payload` to that event's. */
export type BoardEventView = BoardEvent extends infer E
  ? E extends { type: infer T; payload: infer P }
    ? {
        index: number
        type: T
        createdAt: string
        payload: P
        /** The message the event concerns, as it is after the event. */
        message?: MessageView
        /** Who did it, for events with an author: a reaction's reactor, a label's setter. */
        actor?: ActorView & { id: string }
      }
    : never
  : never

export type Discovery = {
  version: string
  url: string
  audience: string
  team_id: string | null
  project_id: string | null
  /** The board's sync entries: `key` names its webhook and inbox, `platform` is e.g. `slack`. */
  sync: { key: string; platform: string }[]
}

export type Me = {
  actor: string
  principal: string
  kind: Actor['kind']
  handle: string
  name: string
  avatar: string | null
  profile: string | null
  session: string | null
  expiresAt: string | null
}

/** A platform account linked to you, as `GET /identity` lists it. */
export type LinkedAccount = { actor: string; handle: string | null; name: string | null; method: 'code' | 'consent'; at: string }
export type IdentityView = { principal: string; links: LinkedAccount[]; cursor: number }
/**
 * How to prove an account is yours: post `code` from it anywhere the board syncs
 * before `expiresAt`, or open `url` (the platform's sign-in) and approve.
 */
export type IdentityChallenge =
  | { method: 'code'; sync: string; platform: string; code: string; expiresAt: string }
  | { method: 'consent'; sync: string; platform: string; url: string }
/** After a sign-in: the account it linked, or null while it hasn't happened. */
export type IdentityCheck = { linked: LinkedAccount | null }

export type ChannelView = Channel
export type MessagesPage = { messages: MessageView[]; cursor: number }
export type ThreadView = { message: MessageView; replies: MessageView[]; cursor: number }
export type EventsPage = { events: BoardEventView[]; cursor: number }

/** The platform threads that now show typing: those the thread is synced to, minus any that failed. */
export type TypingResult = { targets: string[] }

export type ApiError = { error: { code: string; message: string } }

/** A raw platform event, as `GET /inbox/:key` returns it. */
export type InboxEntry = {
  id: string
  channel: string
  createdAt: string
  sync: string
  event: { kind: string; thread: string; [field: string]: unknown }
  raw: unknown
}

/** The route table: method, path, and the schemas that validate input. */
export const routes = {
  discovery: { method: 'GET', path: '/' },
  me: { method: 'GET', path: '/me' },
  channels: { method: 'GET', path: '/channels' },
  actors: { method: 'GET', path: '/actors' },
  messages: { method: 'GET', path: '/messages', query: MessagesQuery },
  message: { method: 'GET', path: '/messages/:id' },
  post: { method: 'POST', path: '/messages', body: PostBody },
  edit: { method: 'POST', path: '/messages/:id/edit', body: EditBody },
  delete: { method: 'POST', path: '/messages/:id/delete', body: DeleteBody },
  react: { method: 'POST', path: '/messages/:id/reactions', body: ReactBody },
  label: { method: 'POST', path: '/messages/:id/labels', body: LabelBody },
  sync: { method: 'POST', path: '/messages/:id/sync', body: SyncBody },
  /** Ephemeral: shows typing in the thread's synced platform threads, and writes nothing to the log. */
  typing: { method: 'POST', path: '/messages/:id/typing', body: TypingBody },
  inbox: { method: 'GET', path: '/inbox/:key', query: InboxQuery },
  webhook: { method: 'POST', path: '/webhooks/:key' },
  events: { method: 'GET', path: '/events', query: EventsQuery },
  avatar: { method: 'GET', path: '/avatars/:name' },
  /** The file is the body; `content-type` is its type and `x-board-filename` its name, URI-encoded. */
  upload: { method: 'POST', path: '/attachments' },
  attachment: { method: 'GET', path: '/attachments/:id' },
  openapi: { method: 'GET', path: '/openapi.json' },
  /** Your linked platform accounts. */
  identity: { method: 'GET', path: '/identity' },
  /** Starts linking a platform account: a one-time code to post from it, or a sign-in URL. */
  identityLink: { method: 'POST', path: '/identity/link', body: IdentityLinkBody },
  /** Finishes a sign-in: links the account it authorized, once it has. */
  identityCheck: { method: 'POST', path: '/identity/check', body: IdentityCheckBody },
  identityUnlink: { method: 'POST', path: '/identity/unlink', body: IdentityUnlinkBody },
} as const

export type RouteName = keyof typeof routes
