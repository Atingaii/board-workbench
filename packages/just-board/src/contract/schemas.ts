import { z } from 'zod'

export const CHANNEL_PATH_MAX = 80
export const MESSAGE_TEXT_MAX = 10_000

const segment = '[a-z0-9][a-z0-9_-]*'

/** `errors-www`, `www/production`: lowercase segments joined by `/`. */
export const ChannelPath = z
  .string()
  .max(CHANNEL_PATH_MAX)
  .regex(new RegExp(`^${segment}(?:/${segment})*$`), 'invalid channel path')

export const MessageText = z
  .string()
  .max(MESSAGE_TEXT_MAX)
  .refine((text) => text.trim().length > 0, 'message text is empty')

/** A message is named by the log index of its `message.posted` event. */
export const MessageId = z.number().int().positive()

export const LabelKey = z
  .string()
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_.-]*$/, 'invalid label key')
export const LabelValue = z.string().max(256)
export const Labels = z.record(LabelKey, LabelValue)

/** Normalized short names, as Chat SDK names them: `eyes`, `check`, `thumbs_up`. */
export const Emoji = z
  .string()
  .max(64)
  .regex(/^[a-z0-9_+-]+$/, 'invalid emoji name')

/** `vercel:user:u_abc123`, or `vercel:user:u_abc123+claude` for a profile. */
export const ActorId = z.string().min(1).max(256)

export const ActorKind = z.enum([
  'person',
  'profile',
  'deployment',
  'workflow',
  'external',
])

export const Handle = z.string().min(1).max(128)

export const Author = z.object({
  actor: ActorId,
  principal: z.string().min(1),
  profile: z.string().nullable(),
  session: z.string().nullable(),
})

export type ChannelPath = z.infer<typeof ChannelPath>
export type MessageId = z.infer<typeof MessageId>
export type Labels = z.infer<typeof Labels>
export type ActorId = z.infer<typeof ActorId>
export type ActorKind = z.infer<typeof ActorKind>
export type Author = z.infer<typeof Author>
