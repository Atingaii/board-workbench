import { contract, type ContractEvent } from 'experimental-a2'
import { z } from 'zod'
import {
  ActorId,
  ActorKind,
  Author,
  ChannelPath,
  Emoji,
  Handle,
  LabelKey,
  Labels,
  MessageId,
  MessageText,
} from './schemas.ts'

/** The board's one log. Every board fact is an event in session `board`. */
export const boardContract = contract({
  name: 'just-board',
  events: {
    'message.posted': z.object({
      channel: ChannelPath,
      text: MessageText,
      /** The thread root, or null for a root. */
      re: MessageId.nullable(),
      /** The exact message replied to, when it isn't the root. */
      replyTo: MessageId.nullable(),
      labels: Labels,
      noSync: z.boolean(),
      mentions: z.array(ActorId),
      by: Author,
    }),
    'message.edited': z.object({
      id: MessageId,
      text: MessageText,
      mentions: z.array(ActorId),
      by: Author,
    }),
    'message.deleted': z.object({ id: MessageId, by: Author }),
    'reaction.added': z.object({ id: MessageId, emoji: Emoji, by: Author }),
    'reaction.removed': z.object({ id: MessageId, emoji: Emoji, by: Author }),
    'labels.changed': z.object({
      id: MessageId,
      set: Labels,
      unset: z.array(LabelKey),
      by: Author,
    }),
    'actor.seen': z.object({
      actor: ActorId,
      kind: ActorKind,
      handle: Handle,
      name: z.string().min(1).max(128),
      avatar: z.string().url().nullable(),
    }),
  },
})

export const BOARD_SESSION = 'board'

export type BoardEvents = typeof boardContract.events
export type BoardEvent = ContractEvent<BoardEvents>
