import { z } from 'zod'
import { createServer, type A2Store, type A2Scheduler } from 'experimental-a2/server'
import {
  boardContract,
  BOARD_SESSION,
  type BoardEvent,
} from '../contract/contract.ts'
import {
  actorsReducer,
  channelsReducer,
  foldMessages,
  messagesReducer,
  type Message,
} from '../contract/reducers.ts'
import {
  EditBody,
  EventsQuery,
  Filters,
  LabelBody,
  MessagesQuery,
  PostBody,
  ReactBody,
  routes,
  type Discovery,
  type Me,
  type RouteName,
} from '../api/routes.ts'
import { VERSION } from '../version.ts'
import {
  allows,
  createVerifier,
  type AuthOptions,
  type Capability,
  type Principal,
  type TrustedSource,
} from './auth.ts'
import { actorSeen, KNOWN_AGENTS, resolveActor, resolveMentions } from './actors.ts'
import { avatarSvg } from './avatars.ts'
import {
  badRequest,
  forbidden,
  json,
  notFound,
  toErrorResponse,
  unauthorized,
} from './errors.ts'
import { compileFilter, liveFeed, pollFeed, view } from './feed.ts'
import { discoveryIdentity, ownProjectId } from './identity.ts'

export type BoardOptions = {
  /** Any A2 store. Omitted: SQLite in development, memory in tests, an error in production. */
  store?: A2Store
  scheduler?: A2Scheduler
  /** Machines outside this project that may call the board. */
  trustedSources?: readonly TrustedSource[]
  /** The board's Vercel project. Defaults to `VERCEL_PROJECT_ID` or `.vercel/project.json`. */
  project?: { id: string; teamId?: string }
  /** The board's public URL, which every token's audience must equal. Inferred from requests otherwise. */
  url?: string
  /** The mount path, e.g. `/api/board`. Inferred from requests otherwise. */
  basePath?: string
  /** Test issuers. Production uses Vercel's and GitHub's. */
  auth?: AuthOptions
  /** SSE streams close after this long, before the platform's limit; clients reconnect. */
  streamMaxMs?: number
}

const boardServer = (options: BoardOptions) =>
  createServer({
    contract: boardContract,
    ...(options.store ? { store: options.store } : {}),
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
  })

export type BoardSession = ReturnType<ReturnType<typeof boardServer>['session']>

type Match = { name: RouteName; base: string; id?: number; param?: string }

// Most specific first; each route is matched as a suffix of the request path.
const PATTERNS: { method: string; name: RouteName; pattern: RegExp }[] = [
  { method: 'POST', name: 'edit', pattern: /\/messages\/(\d+)\/edit$/ },
  { method: 'POST', name: 'delete', pattern: /\/messages\/(\d+)\/delete$/ },
  { method: 'POST', name: 'react', pattern: /\/messages\/(\d+)\/reactions$/ },
  { method: 'POST', name: 'label', pattern: /\/messages\/(\d+)\/labels$/ },
  { method: 'GET', name: 'message', pattern: /\/messages\/(\d+)$/ },
  { method: 'GET', name: 'messages', pattern: /\/messages$/ },
  { method: 'POST', name: 'post', pattern: /\/messages$/ },
  { method: 'GET', name: 'channels', pattern: /\/channels$/ },
  { method: 'GET', name: 'actors', pattern: /\/actors$/ },
  { method: 'GET', name: 'events', pattern: /\/events$/ },
  { method: 'GET', name: 'me', pattern: /\/me$/ },
  { method: 'GET', name: 'avatar', pattern: /\/avatars\/([a-z0-9-]+)$/ },
  { method: 'GET', name: 'openapi', pattern: /\/openapi\.json$/ },
]

function route(method: string, pathname: string, basePath?: string): Match | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (basePath !== undefined) {
    const base = basePath.replace(/\/+$/, '')
    if (path !== base && !path.startsWith(`${base}/`)) return null
    const rest = path.slice(base.length) || '/'
    if (rest === '/') return method === 'GET' ? { name: 'discovery', base } : null
    for (const candidate of PATTERNS) {
      const found = rest.match(new RegExp(`^${candidate.pattern.source}`))
      if (candidate.method === method && found) return withParam(candidate.name, base, found[1])
    }
    return null
  }
  for (const candidate of PATTERNS) {
    if (candidate.method !== method) continue
    const found = path.match(candidate.pattern)
    if (found) return withParam(candidate.name, path.slice(0, found.index), found[1])
  }
  return method === 'GET' ? { name: 'discovery', base: path === '/' ? '' : path } : null
}

const withParam = (name: RouteName, base: string, param: string | undefined): Match =>
  param === undefined
    ? { name, base }
    : /^\d+$/.test(param)
      ? { name, base, id: Number(param) }
      : { name, base, param }

function queryObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key)
    out[key] = values.length > 1 ? values : values[0]!
  }
  return out
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw badRequest('request body is not valid JSON')
  }
}

/** Mounts a board: one log in one route. */
export function board(options: BoardOptions = {}) {
  const server = boardServer(options)
  const session = server.session(BOARD_SESSION)
  const verify = createVerifier({
    projectId: () => ownProjectId(options.project),
    trustedSources: options.trustedSources ?? [],
    ...(options.auth ? { auth: options.auth } : {}),
  })
  const streamMaxMs = options.streamMaxMs ?? 280_000

  async function authenticate(request: Request, boardUrl: string): Promise<Principal> {
    const header = request.headers.get('authorization') ?? ''
    const token = header.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) throw unauthorized('missing bearer token')
    return verify(token, boardUrl)
  }

  const require = (principal: Principal, capability: Capability) => {
    if (!allows(principal, capability))
      throw forbidden(`this source may not ${capability === 'post' ? 'post' : capability}`)
  }

  async function messageOr404(id: number): Promise<Message> {
    const { state } = await session.state(messagesReducer)
    const message = state.byId[id]
    if (!message) throw notFound(`message not found: #${id}`, 'message_not_found')
    return message
  }

  async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      const match = route(request.method, url.pathname, options.basePath)
      if (!match) throw notFound(`no route: ${request.method} ${url.pathname}`)
      const boardUrl = (options.url ?? `${url.origin}${match.base}`).replace(/\/+$/, '')

      switch (match.name) {
        case 'discovery': {
          const identity = await discoveryIdentity(request, options.project)
          const body: Discovery = {
            version: VERSION,
            url: boardUrl,
            audience: boardUrl,
            team_id: identity.teamId,
            project_id: identity.projectId,
          }
          return json(body)
        }
        case 'avatar': {
          const name = match.param ?? ''
          if (!(KNOWN_AGENTS as readonly string[]).includes(name)) throw notFound(`no avatar: ${name}`)
          return new Response(avatarSvg(name), {
            headers: {
              'content-type': 'image/svg+xml',
              'cache-control': 'public, max-age=86400',
            },
          })
        }
        case 'openapi':
          return json(openapi())
      }

      const principal = await authenticate(request, boardUrl)
      const { author, actor } = resolveActor(principal, request.headers, boardUrl)

      switch (match.name) {
        case 'me': {
          const body: Me = {
            actor: actor.id,
            principal: principal.id,
            kind: actor.kind,
            handle: actor.handle,
            name: actor.name,
            avatar: actor.avatar,
            profile: author.profile,
            session: author.session,
            expiresAt: principal.expiresAt?.toISOString() ?? null,
          }
          return json(body)
        }
        case 'channels': {
          const { state, index } = await session.state(channelsReducer)
          const channels = Object.values(state).sort((a, b) => a.path.localeCompare(b.path))
          return json({ channels, cursor: index })
        }
        case 'actors': {
          const { state, index } = await session.state(actorsReducer)
          const actors = Object.values(state.byId).sort((a, b) => a.handle.localeCompare(b.handle))
          return json({ actors, cursor: index })
        }
        case 'messages': {
          const query = MessagesQuery.parse(queryObject(url))
          const [{ state, index }, { state: actors }] = await Promise.all([
            session.state(messagesReducer),
            session.state(actorsReducer),
          ])
          const match = compileFilter(query, { me: actor.id, actors })
          let found = Object.values(state.byId)
            .filter((message) => match(message) || !hasAnyFilter(query))
            .sort((a, b) => a.id - b.id)
          if (query.before !== undefined) found = found.filter((m) => m.id < query.before!)
          const limit = query.limit ?? 50
          found =
            query.after !== undefined
              ? found.filter((m) => m.id > query.after!).slice(0, limit)
              : found.slice(-limit)
          return json({ messages: found.map((m) => view(m, actors)), cursor: index })
        }
        case 'message': {
          const [{ state, index }, { state: actors }] = await Promise.all([
            session.state(messagesReducer),
            session.state(actorsReducer),
          ])
          const message = state.byId[match.id!]
          if (!message) throw notFound(`message not found: #${match.id}`, 'message_not_found')
          const root = message.re === null ? message : state.byId[message.re]!
          const replies = (state.replies[root.id] ?? []).map((id) => view(state.byId[id]!, actors))
          return json({ message: view(root, actors), replies, cursor: index })
        }
        case 'post': {
          require(principal, 'post')
          const body = PostBody.parse(await readJson(request))
          const [{ state: messages }, { state: actors }] = await Promise.all([
            session.state(messagesReducer),
            session.state(actorsReducer),
          ])
          let channel = body.channel
          let re: number | null = null
          let replyTo: number | null = null
          if (body.re !== undefined) {
            const target = messages.byId[body.re]
            if (!target) throw notFound(`message not found: #${body.re}`, 'message_not_found')
            re = target.re ?? target.id
            replyTo = target.id === re ? null : target.id
            channel = target.channel
          }
          const seen = actorSeen(actor, actors)
          const mentions = resolveMentions(body.text, actors, seen ? actor : undefined)
          const rows = await session.append(
            ...(seen ? [seen] : []),
            {
              type: 'message.posted',
              ...(body.id ? { id: body.id } : {}),
              payload: {
                channel: channel!,
                text: body.text,
                re,
                replyTo,
                labels: body.labels ?? {},
                noSync: body.noSync ?? false,
                mentions,
                by: author,
              },
            },
          )
          const posted = rows.find((row) => row.type === 'message.posted') as BoardEvent
          const message = foldMessages({ byId: {}, replies: {} }, posted).byId[posted.index]!
          const known = seen ? { ...actors, byId: { ...actors.byId, [actor.id]: actor } } : actors
          return json({ message: view(message, known) }, 201)
        }
        case 'edit': {
          require(principal, 'post')
          const body = EditBody.parse(await readJson(request))
          const message = await messageOr404(match.id!)
          if (message.by.principal !== principal.id)
            throw forbidden('only the author can edit a message')
          if (message.deleted) throw badRequest('message was deleted', 'message_deleted')
          const { state: actors } = await session.state(actorsReducer)
          const seen = actorSeen(actor, actors)
          const mentions = resolveMentions(body.text, actors, seen ? actor : undefined)
          await session.append(...(seen ? [seen] : []), {
            type: 'message.edited',
            payload: { id: message.id, text: body.text, mentions, by: author },
          })
          return json({ ok: true })
        }
        case 'delete': {
          require(principal, 'post')
          const message = await messageOr404(match.id!)
          if (message.by.principal !== principal.id)
            throw forbidden('only the author can delete a message')
          if (!message.deleted)
            await session.append({
              type: 'message.deleted',
              payload: { id: message.id, by: author },
            })
          return json({ ok: true })
        }
        case 'react': {
          require(principal, 'react')
          const body = ReactBody.parse(await readJson(request))
          const message = await messageOr404(match.id!)
          if (message.deleted) throw badRequest('message was deleted', 'message_deleted')
          const { state: actors } = await session.state(actorsReducer)
          const seen = actorSeen(actor, actors)
          await session.append(...(seen ? [seen] : []), {
            type: body.remove ? 'reaction.removed' : 'reaction.added',
            payload: { id: message.id, emoji: body.emoji, by: author },
          })
          return json({ ok: true })
        }
        case 'label': {
          require(principal, 'label')
          const body = LabelBody.parse(await readJson(request))
          const message = await messageOr404(match.id!)
          if (message.deleted) throw badRequest('message was deleted', 'message_deleted')
          await session.append({
            type: 'labels.changed',
            payload: { id: message.id, set: body.set ?? {}, unset: body.unset ?? [], by: author },
          })
          return json({ ok: true })
        }
        case 'events': {
          const query = EventsQuery.parse(queryObject(url))
          const lastEventId = Number(request.headers.get('last-event-id'))
          const after =
            query.after ?? (Number.isInteger(lastEventId) && lastEventId > 0 ? lastEventId : undefined)
          const { state: actors } = await session.state(actorsReducer)
          const feedOptions = {
            session,
            after,
            filters: query,
            all: query.all ?? false,
            me: actor.id,
            actors,
          }
          if ((request.headers.get('accept') ?? '').includes('text/event-stream'))
            return sse(feedOptions, request.signal, streamMaxMs)
          const page = await pollFeed(feedOptions, (query.wait ?? 0) * 1000, request.signal)
          return json(page)
        }
      }
      throw notFound(`no route: ${request.method} ${url.pathname}`)
    } catch (error) {
      return toErrorResponse(error)
    }
  }

  return { GET: handle, POST: handle, fetch: handle, server }
}

const hasAnyFilter = (query: z.output<typeof Filters>) =>
  query.channel !== undefined ||
  query.re !== undefined ||
  query.by !== undefined ||
  query.mentions !== undefined ||
  (query.label?.length ?? 0) > 0

/** Server-sent events: `id` is the log index, so `Last-Event-ID` resumes exactly. */
function sse(
  options: Parameters<typeof liveFeed>[0],
  requestSignal: AbortSignal,
  maxMs: number,
): Response {
  const encoder = new TextEncoder()
  const controller = new AbortController()
  const signal = AbortSignal.any([requestSignal, controller.signal, AbortSignal.timeout(maxMs)])
  const body = new ReadableStream<Uint8Array>({
    async start(stream) {
      const ping = setInterval(() => {
        try {
          stream.enqueue(encoder.encode(': ping\n\n'))
        } catch {}
      }, 15_000)
      try {
        stream.enqueue(encoder.encode(': connected\n\n'))
        // Filtered-out events still advance the client's cursor with a bare `id:`.
        for await (const item of liveFeed(options, signal)) {
          stream.enqueue(
            encoder.encode(
              item.view
                ? `id: ${item.index}\nevent: board\ndata: ${JSON.stringify(item.view)}\n\n`
                : `id: ${item.index}\n\n`,
            ),
          )
        }
      } catch (error) {
        console.error('[just-board] feed failed', error)
      } finally {
        clearInterval(ping)
        try {
          stream.close()
        } catch {}
      }
    },
    cancel() {
      controller.abort()
    },
  })
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  })
}

function openapi() {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const [name, definition] of Object.entries(routes)) {
    const path = definition.path.replace(/:(\w+)/g, '{$1}')
    const operation: Record<string, unknown> = { operationId: name }
    if ('query' in definition)
      operation['x-query-schema'] = z.toJSONSchema(definition.query, { io: 'input' })
    if ('body' in definition)
      operation.requestBody = {
        content: { 'application/json': { schema: z.toJSONSchema(definition.body, { io: 'input' }) } },
      }
    ;(paths[path] ??= {})[definition.method.toLowerCase()] = operation
  }
  return { openapi: '3.1.0', info: { title: 'just-board', version: VERSION }, paths }
}
