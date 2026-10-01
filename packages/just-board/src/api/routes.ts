import { z } from 'zod'
import {
  ChannelPath,
  Emoji,
  LabelKey,
  Labels,
  MessageId,
  MessageText,
} from '../contract/schemas.ts'
import type { Actor, Channel, Message } from '../contract/reducers.ts'

const id = z.coerce.number().int().positive()
const repeated = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]))

/** `status=open` → `['status', 'open']`. */
const LabelFilter = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_.-]*=.*$/, 'label filters look like key=value')
  .transform((value) => {
    const at = value.indexOf('=')
    return [value.slice(0, at), value.slice(at + 1)] as const
  })

/** Shared by `/messages` and `/events`. */
export const Filters = z.object({
  channel: z.string().optional(),
  re: id.optional(),
  by: z.string().optional(),
  mentions: z.string().optional(),
  label: repeated.pipe(z.array(LabelFilter)).optional(),
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
    text: MessageText,
    labels: Labels.optional(),
    noSync: z.boolean().optional(),
    id: z.string().min(1).max(200).optional(),
  })
  .refine((body) => (body.channel === undefined) !== (body.re === undefined), {
    message: 'a post needs `channel`; a reply needs `re`',
  })

export const EditBody = z.object({ text: MessageText })
export const DeleteBody = z.object({}).optional()
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

export type ActorView = Pick<Actor, 'handle' | 'name' | 'avatar'>
export type MessageView = Message & { author: ActorView | null }

export type BoardEventView = {
  index: number
  type: string
  createdAt: string
  payload: unknown
  /** The message the event concerns, as it is after the event. */
  message?: MessageView
}

export type Discovery = {
  version: string
  url: string
  audience: string
  team_id: string | null
  project_id: string | null
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

export type ChannelView = Channel
export type MessagesPage = { messages: MessageView[]; cursor: number }
export type ThreadView = { message: MessageView; replies: MessageView[]; cursor: number }
export type EventsPage = { events: BoardEventView[]; cursor: number }

export type ApiError = { error: { code: string; message: string } }

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
  events: { method: 'GET', path: '/events', query: EventsQuery },
  avatar: { method: 'GET', path: '/avatars/:name' },
  openapi: { method: 'GET', path: '/openapi.json' },
} as const

export type RouteName = keyof typeof routes
