import { randomUUID } from 'node:crypto'
import { idempotentId } from 'experimental-a2'
import type { BoardEvent, Origin } from '../contract/contract.ts'
import {
  actorsReducer,
  foldMessages,
  messagesReducer,
  syncReducer,
  type Actor,
  type ActorsState,
  type Message,
} from '../contract/reducers.ts'
import type { Author, Labels } from '../contract/schemas.ts'
import type { Principal } from './auth.ts'
import { actorSeen, resolveMentions } from './actors.ts'
import type { BoardSession } from './board.ts'
import { badRequest, forbidden, notFound } from './errors.ts'
import { view } from './feed.ts'

/** Who a write is attributed to. */
export type Identity = { principal: Principal; author: Author; actor: Actor }

export type WriteContext = {
  session: BoardSession
  /** External channels a new root in this board channel starts threads in. */
  configTargets: (channel: string) => Promise<string[]>
  /** Validates a requested target and resolves names (`slack:#prs`) to IDs. */
  normalizeTarget: (target: string) => Promise<string>
}

export type PostInput = {
  identity: Identity
  channel?: string | undefined
  re?: number | undefined
  text: string
  labels?: Labels | undefined
  noSync?: boolean | undefined
  id?: string | undefined
  sync?: string[] | undefined
  origin?: Origin | null
  from?: string | null
  /** Platform text: mentions the board can't resolve are left as plain text. */
  lenientMentions?: boolean
}

function mentionsFor(text: string, actors: ActorsState, pending: Actor | undefined, lenient: boolean) {
  if (!lenient) return resolveMentions(text, actors, pending)
  try {
    return resolveMentions(text, actors, pending)
  } catch {
    return []
  }
}

export async function writePost(ctx: WriteContext, input: PostInput) {
  const [{ state: messages }, { state: actors }] = await Promise.all([
    ctx.session.state(messagesReducer),
    ctx.session.state(actorsReducer),
  ])
  const { identity } = input
  let channel = input.channel
  let re: number | null = null
  let replyTo: number | null = null
  let thread: string
  const id = input.id ?? (input.re === undefined ? randomUUID() : undefined)
  if (input.re !== undefined) {
    const target = messages.byId[input.re]
    if (!target) throw notFound(`message not found: #${input.re}`, 'message_not_found')
    re = target.re ?? target.id
    replyTo = target.id === re ? null : target.id
    channel = target.channel
    thread = messages.byId[re]!.thread
    if (input.sync?.length)
      throw badRequest('sync attaches whole threads: use `just-board sync <id> <target>`')
  } else {
    if (!channel) throw badRequest('a post needs a channel')
    thread = id!
  }

  const targets: { target: string; cause: 'config' | 'request' }[] = []
  if (re === null) {
    const originChannel = input.origin ? channelOf(input.origin.thread) : null
    if (!input.noSync)
      for (const target of await ctx.configTargets(channel!))
        if (target !== originChannel) targets.push({ target, cause: 'config' })
    for (const requested of input.sync ?? []) {
      const target = await ctx.normalizeTarget(requested)
      if (!targets.some((t) => t.target === target)) targets.push({ target, cause: 'request' })
    }
  }

  const seen = actorSeen(identity.actor, actors)
  const mentions = mentionsFor(input.text, actors, seen ? identity.actor : undefined, input.lenientMentions ?? false)
  const synced = await Promise.all(
    targets.map(async ({ target, cause }) => ({
      type: 'thread.synced' as const,
      id: await idempotentId('just-board', thread, 'sync', target),
      payload: { thread, target, cause, by: identity.author },
    })),
  )
  const rows = await ctx.session.append(
    ...(seen ? [seen] : []),
    {
      type: 'message.posted',
      ...(id ? { id } : {}),
      payload: {
        channel: channel!,
        text: input.text,
        re,
        replyTo,
        thread,
        labels: input.labels ?? {},
        noSync: input.noSync ?? false,
        mentions,
        by: identity.author,
        origin: input.origin ?? null,
        from: input.from ?? null,
      },
    },
    ...synced,
  )
  const posted = rows.find((row) => row.type === 'message.posted') as BoardEvent
  const message = foldMessages({ byId: {}, replies: {} }, posted).byId[posted.index]!
  const known = seen ? { ...actors, byId: { ...actors.byId, [identity.actor.id]: identity.actor } } : actors
  return view(message, known)
}

/** `slack:C0123ABC:1727.1` → `slack:C0123ABC`; `github:o/r:12` → `github:o/r`. */
export const channelOf = (externalThread: string) => {
  const at = externalThread.indexOf(':')
  const rest = externalThread.slice(at + 1)
  const colon = rest.indexOf(':')
  return colon === -1 ? externalThread : externalThread.slice(0, at + 1 + colon)
}

async function liveMessage(ctx: WriteContext, id: number): Promise<Message> {
  const { state } = await ctx.session.state(messagesReducer)
  const message = state.byId[id]
  if (!message) throw notFound(`message not found: #${id}`, 'message_not_found')
  return message
}

export async function writeEdit(
  ctx: WriteContext,
  input: { identity: Identity; id: number; text: string; from?: string | null; asAuthor?: boolean },
) {
  const message = await liveMessage(ctx, input.id)
  if (input.asAuthor !== false && message.by.principal !== input.identity.principal.id)
    throw forbidden('only the author can edit a message')
  if (message.deleted) throw badRequest('message was deleted', 'message_deleted')
  const { state: actors } = await ctx.session.state(actorsReducer)
  const seen = actorSeen(input.identity.actor, actors)
  const mentions = mentionsFor(input.text, actors, seen ? input.identity.actor : undefined, input.from != null)
  await ctx.session.append(...(seen ? [seen] : []), {
    type: 'message.edited',
    payload: {
      id: message.id,
      thread: message.thread,
      text: input.text,
      mentions,
      by: input.identity.author,
      from: input.from ?? null,
    },
  })
}

export async function writeDelete(
  ctx: WriteContext,
  input: { identity: Identity; id: number; from?: string | null; asAuthor?: boolean },
) {
  const message = await liveMessage(ctx, input.id)
  if (input.asAuthor !== false && message.by.principal !== input.identity.principal.id)
    throw forbidden('only the author can delete a message')
  if (message.deleted) return
  await ctx.session.append({
    type: 'message.deleted',
    payload: { id: message.id, thread: message.thread, by: input.identity.author, from: input.from ?? null },
  })
}

export async function writeReaction(
  ctx: WriteContext,
  input: { identity: Identity; id: number; emoji: string; remove?: boolean; from?: string | null },
) {
  const message = await liveMessage(ctx, input.id)
  if (message.deleted) throw badRequest('message was deleted', 'message_deleted')
  const { state: actors } = await ctx.session.state(actorsReducer)
  const seen = actorSeen(input.identity.actor, actors)
  await ctx.session.append(...(seen ? [seen] : []), {
    type: input.remove ? 'reaction.removed' : 'reaction.added',
    payload: {
      id: message.id,
      thread: message.thread,
      emoji: input.emoji,
      by: input.identity.author,
      from: input.from ?? null,
    },
  })
}

export async function writeLabels(
  ctx: WriteContext,
  input: { identity: Identity; id: number; set?: Labels | undefined; unset?: string[] | undefined },
) {
  const message = await liveMessage(ctx, input.id)
  if (message.deleted) throw badRequest('message was deleted', 'message_deleted')
  const { state: actors } = await ctx.session.state(actorsReducer)
  const seen = actorSeen(input.identity.actor, actors)
  await ctx.session.append(...(seen ? [seen] : []), {
    type: 'labels.changed',
    payload: {
      id: message.id,
      thread: message.thread,
      set: input.set ?? {},
      unset: input.unset ?? [],
      by: input.identity.author,
    },
  })
}

/** Attaches a thread to an external target. Attaching twice is a no-op. */
export async function writeAttach(
  ctx: WriteContext,
  input: { identity: Identity; id: number; target: string },
) {
  const message = await liveMessage(ctx, input.id)
  const target = await ctx.normalizeTarget(input.target)
  const { state: sync } = await ctx.session.state(syncReducer)
  if (sync.threads[message.thread]?.targets.includes(target)) return { target, attached: false }
  await ctx.session.append({
    type: 'thread.synced',
    id: await idempotentId('just-board', message.thread, 'sync', target),
    payload: { thread: message.thread, target, cause: 'request', by: input.identity.author },
  })
  return { target, attached: true }
}
