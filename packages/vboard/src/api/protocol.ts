import type { z } from 'zod'
import type { Actor } from '../contract/reducers.ts'
import type { Attachment } from '../contract/schemas.ts'
import type {
  AckBody,
  ChannelView,
  EditBody,
  EventsPage,
  EventsQuery,
  IdentityView,
  LabelBody,
  MatchesQuery,
  MatchView,
  Me,
  MessagesPage,
  MessagesQuery,
  MessageView,
  PersonView,
  PostBody,
  ReactBody,
  RegisterBody,
  RegistrationView,
  ScheduleBody,
  SchedulesQuery,
  ScheduleView,
  ThreadsPage,
  ThreadsQuery,
  ThreadView,
  TypingBody,
  TypingResult,
} from './routes.ts'

type Input<S extends z.ZodType> = NonNullable<z.output<S>>
type Id = { id: string }
type Nothing = Record<string, never>

/**
 * The protocol, method by method: what each takes and what it answers, as the wire carries them.
 * board() serves each at its route in `routes` and calls the backend's method of the same name.
 */
export type Protocol = {
  me: { input: Nothing; output: Me }
  channels: { input: Nothing; output: { channels: ChannelView[]; cursor: string } }
  actors: { input: Nothing; output: { actors: (Actor & { person?: PersonView })[]; cursor: string } }
  identity: { input: Nothing; output: IdentityView }
  messages: { input: Input<typeof MessagesQuery>; output: MessagesPage }
  threads: { input: Input<typeof ThreadsQuery>; output: ThreadsPage }
  message: { input: Id; output: ThreadView }
  post: { input: Input<typeof PostBody>; output: { message: MessageView; unknownMentions?: string[] } }
  edit: { input: Id & Input<typeof EditBody>; output: { ok: true; unknownMentions?: string[] } }
  delete: { input: Id; output: { ok: true } }
  react: { input: Id & Input<typeof ReactBody>; output: { ok: true } }
  label: { input: Id & Input<typeof LabelBody>; output: { ok: true } }
  typing: { input: Id & Input<typeof TypingBody>; output: TypingResult }
  schedule: { input: Input<typeof ScheduleBody>; output: { schedule: ScheduleView; unknownMentions?: string[] } }
  schedules: { input: Input<typeof SchedulesQuery>; output: { schedules: ScheduleView[] } }
  cancelSchedule: { input: Id; output: { schedule: ScheduleView; canceled: boolean } }
  upload: { input: { data: Uint8Array; name: string | null; type: string | null }; output: { attachment: Attachment } }
  attachment: { input: Id; output: { attachment: Attachment; data: Uint8Array | ReadableStream<Uint8Array> } }
  watchers: { input: Nothing; output: { watchers: RegistrationView[] } }
  register: { input: Input<typeof RegisterBody>; output: RegistrationView }
  matches: { input: Input<typeof MatchesQuery>; output: { matches: MatchView[] } }
  ack: { input: Id & Input<typeof AckBody>; output: { ok: true } }
  /** Long-polls with `wait`. board() serves SSE from it, so a backend has one way to read events. */
  events: { input: Input<typeof EventsQuery>; output: EventsPage }
}

export type Method = keyof Protocol
