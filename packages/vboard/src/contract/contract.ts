import { contract, type ContractEvent } from 'experimental-a2'
import { z } from 'zod'
import {
  ActorId,
  Attachment,
  ATTACHMENTS_PER_MESSAGE_MAX,
  SeenActorKind,
  Author,
  ChannelPath,
  Emoji,
  Handle,
  LabelKey,
  Labels,
  MessageId,
  MessageText,
} from './schemas.ts'

/**
 * An external thread or channel, prefixed with its sync key:
 * `slack:C0123ABC` (a channel), `slack:C0123ABC:1727.1234` (a thread),
 * `github:basehub-ai/www:12` (a PR thread).
 */
export const ExternalTarget = z.string().min(3).max(300)

/** Where a message came from on a platform. `thread` is grouped (GitHub review threads fold into their PR). */
export const Origin = z.object({
  thread: ExternalTarget,
  /** The exact platform thread, when it differs from `thread`. */
  subthread: ExternalTarget.nullable(),
  message: z.string().min(1).max(300),
  context: z.string().max(300).nullable(),
})

/** The sync key a write came from, or null when it was written on the board. */
const From = z.string().nullable()

/** The thread key: the event ID of the thread's root. Lanes and sync state are keyed by it. */
const ThreadKey = z.string().min(1).max(200)

/** The board's one log. Every board fact is an event in session `board`. */
export const boardContract = contract({
  name: 'vboard',
  events: {
    'message.posted': z.object({
      channel: ChannelPath,
      /** Empty only when the message has attachments. */
      text: z.union([MessageText, z.literal('')]),
      /** The thread root, or null for a root. */
      re: MessageId.nullable(),
      /** The exact message replied to, when it isn't the root. */
      replyTo: MessageId.nullable(),
      thread: ThreadKey,
      labels: Labels,
      noSync: z.boolean(),
      mentions: z.array(ActorId),
      by: Author,
      origin: Origin.nullable(),
      from: From,
      /** Files on the message. Events written before attachments have none. */
      attachments: z.array(Attachment).max(ATTACHMENTS_PER_MESSAGE_MAX).optional(),
    }),
    'message.edited': z.object({
      id: MessageId,
      thread: ThreadKey,
      text: MessageText,
      mentions: z.array(ActorId),
      by: Author,
      from: From,
    }),
    'message.deleted': z.object({ id: MessageId, thread: ThreadKey, by: Author, from: From }),
    'reaction.added': z.object({ id: MessageId, thread: ThreadKey, emoji: Emoji, by: Author, from: From }),
    'reaction.removed': z.object({ id: MessageId, thread: ThreadKey, emoji: Emoji, by: Author, from: From }),
    'labels.changed': z.object({
      id: MessageId,
      thread: ThreadKey,
      set: Labels,
      unset: z.array(LabelKey),
      by: Author,
    }),
    /** A thread is synced with an external channel (start a thread there) or thread (join it). */
    'thread.synced': z.object({
      thread: ThreadKey,
      target: ExternalTarget,
      cause: z.enum(['config', 'request']),
      by: Author,
    }),
    /** An outbound delivery receipt: board message `id` exists on the platform as `external`. */
    'message.synced': z.object({
      id: MessageId,
      thread: ThreadKey,
      target: ExternalTarget,
      external: z.object({ thread: ExternalTarget, message: z.string().min(1).max(300) }),
    }),
    /** A delivery that gave up: board message `id` didn't reach `target`, and `error` says why. */
    'message.sync_failed': z.object({
      id: MessageId,
      thread: ThreadKey,
      target: ExternalTarget,
      error: z.string().min(1).max(500),
    }),
    'actor.seen': z.object({
      actor: ActorId,
      kind: SeenActorKind,
      handle: Handle,
      name: z.string().min(1).max(128),
      avatar: z.string().url().nullable(),
    }),
  },
})

export const BOARD_SESSION = 'board'

export type BoardEvents = typeof boardContract.events
export type BoardEvent = ContractEvent<BoardEvents>
export type Origin = z.infer<typeof Origin>

const ExternalAuthor = z.object({
  /** The platform principal, e.g. `slack:user:U0456`. */
  id: z.string().min(1),
  handle: z.string().min(1),
  name: z.string().min(1),
  avatar: z.string().nullable(),
  isBot: z.boolean(),
})

/** A platform event, normalized at intake. Thread IDs are external IDs with the sync key prefix. */
export const ExternalEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    channel: ExternalTarget,
    thread: ExternalTarget,
    subthread: ExternalTarget.nullable(),
    message: z.string(),
    isRoot: z.boolean(),
    text: z.string(),
    context: z.string().nullable(),
    author: ExternalAuthor,
  }),
  z.object({
    kind: z.literal('edited'),
    channel: ExternalTarget,
    thread: ExternalTarget,
    subthread: ExternalTarget.nullable(),
    message: z.string(),
    text: z.string(),
    author: ExternalAuthor,
  }),
  z.object({
    kind: z.literal('deleted'),
    channel: ExternalTarget,
    thread: ExternalTarget,
    subthread: ExternalTarget.nullable(),
    message: z.string(),
  }),
  z.object({
    kind: z.literal('reaction'),
    channel: ExternalTarget,
    thread: ExternalTarget,
    subthread: ExternalTarget.nullable(),
    message: z.string(),
    emoji: z.string(),
    added: z.boolean(),
    author: ExternalAuthor,
  }),
  z.object({
    /** A platform lifecycle event: a PR opening, closing, being reviewed. */
    kind: z.literal('lifecycle'),
    channel: ExternalTarget,
    thread: ExternalTarget,
    type: z.string(),
    title: z.string(),
    url: z.string().nullable(),
    labels: z.record(z.string(), z.string()),
    unset: z.array(z.string()),
    /** Key prefixes the platform owns on the root, e.g. `tag.`: keys under them that aren't in `labels` are unset. */
    owns: z.array(z.string()).optional(),
    /** A reply to add to the thread, e.g. "merged by julian". */
    reply: z.string().nullable(),
    /** Create the root if the board hasn't seen this thread. */
    createRoot: z.boolean(),
    author: ExternalAuthor,
  }),
])

export type ExternalEvent = z.infer<typeof ExternalEvent>
export type ExternalAuthor = z.infer<typeof ExternalAuthor>

/** Raw platform events live outside the board log, one session per external channel. */
export const inboxContract = contract({
  name: 'vboard-inbox',
  events: {
    'external.received': z.object({
      sync: z.string().min(1),
      event: ExternalEvent,
      raw: z.unknown(),
    }),
  },
})

export type InboxEvents = typeof inboxContract.events
export type InboxEvent = ContractEvent<InboxEvents>

/** `inbox:slack:C0123ABC`: the inbox session for one external channel. */
export const inboxSession = (channel: string) => `inbox:${channel}`

/** What watchers matched, outside the board log: one session per watcher, so each fails on its own. */
export const watchContract = contract({
  name: 'vboard-watch',
  events: {
    'watch.matched': z.object({
      thread: ThreadKey,
      /** The board event, as `vb tail --json` prints it. */
      event: z.unknown(),
    }),
  },
})

export type WatchEvents = typeof watchContract.events

/** `watch:triage`: the session for one watcher. */
export const watchSession = (id: string) => `watch:${id}`
