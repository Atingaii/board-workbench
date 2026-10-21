import { idempotentId } from 'experimental-a2'
import {
  AckBody,
  EditBody,
  EventsQuery,
  LabelBody,
  MatchesQuery,
  MessagesQuery,
  PostBody,
  ReactBody,
  Ref,
  RegisterBody,
  ScheduleBody,
  SchedulesQuery,
  ThreadsQuery,
  TypingBody,
  type Discovery,
} from '../api/routes.ts'
import type { Method, Protocol } from '../api/protocol.ts'
import { createBoardClient, type BoardClient } from '../client/client.ts'
import { ATTACHMENT_BYTES_MAX } from '../contract/schemas.ts'
import { VERSION } from '../version.ts'
import type { Backend, BoardBinding, Caller } from './backend.ts'
import { createVerifier, hostPrincipal, type AccessRule, type AuthOptions, type HostAccess, type Principal } from './auth.ts'
import { parseScope, type Access } from './access.ts'
import { KNOWN_AGENTS, resolveActor } from './actors.ts'
import { avatarSvg } from './avatars.ts'
import { badRequest, json, notFound, toErrorResponse, unauthorized } from './errors.ts'
import { discoveryIdentity, ownProjectId, ownTeamId } from './identity.ts'
import { createRouter, openapi, queryObject, readCapped, readJson } from './routing.ts'
import type { Watcher } from './watch.ts'

/** `board()`'s options: where the board lives, who may use it, and the watchers that run here. */
export type BoardOptions = {
  /** Where the board lives: `a2({ … })` from `vboard/backend-a2`, `http(url)` from `vboard/backend-http`, or your own. */
  backend: Backend
  /** Tails the board runs for you, keyed by an id you choose: `{ triage: { tail: 'firehose', run } }`. */
  watch?: Record<string, Watcher>
  /** The board's public URL, which every token's audience must equal. Inferred from requests otherwise. */
  url?: string
  /** The mount path, e.g. `/api/board`. Inferred from requests otherwise. */
  basePath?: string
  /**
   * Who may call the board besides its people and its own deployments in the
   * environment it runs in (a production board's previews need a rule), and what
   * they may do in each channel: `vercelProject()`, `githubActions()`, `oidc()`.
   * The first rule that matches a token decides.
   *
   * Or a function, `(request) => ({ id, kind, handle, can })`, that replaces the built-in
   * verifier: a host's own credentials, for a host serving many teams' boards. Nothing
   * else is trusted then, not the board's own project nor any token's audience. To reject,
   * return or throw a `Response`.
   */
  access?: readonly AccessRule[] | HostAccess
  /** The board's Vercel project. Defaults to `VERCEL_PROJECT_ID` or `.vercel/project.json`. */
  project?: { id: string; teamId?: string }
  /** Test issuers. Production uses Vercel's and GitHub's. */
  auth?: AuthOptions
  /** SSE streams close after this long, before the platform's limit; clients reconnect. */
  streamMaxMs?: number
}

/** What `board()` mounts: its handlers, and a client for your own server code. */
export type Board = {
  GET(request: Request): Promise<Response>
  POST(request: Request): Promise<Response>
  /** The same handler, for runtimes that take one function. */
  fetch(request: Request): Promise<Response>
  /**
   * A client for your own server code, writing as `name`: `vboard:client:<name>` on `a2()`, this
   * deployment with `name` as its profile on `http()`. With a `key` (a webhook delivery's ID, say),
   * its posts are idempotent: the same key and order never post twice. Its writes wake watchers
   * and sync like any other.
   */
  client(name: string, options?: { key?: string }): BoardClient
}

/** A host's `access` function rejected the request with this response. */
class Rejected {
  readonly response: Response
  constructor(response: Response) {
    this.response = response
  }
}

/** The methods whose answer is something new. */
const CREATED = new Set<Method>(['post', 'schedule', 'upload'])

/** Shown inline only when a browser can't run it: everything else downloads. */
const INLINE = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm)|text\/plain)$/

/**
 * The file, sandboxed: it can't run as a page on the board's origin, and only
 * types a browser can't execute display inline.
 */
function attachmentResponse({ attachment, data }: Protocol['attachment']['output']): Response {
  const disposition = INLINE.test(attachment.type) ? 'inline' : 'attachment'
  const body = data instanceof Uint8Array ? new Blob([data as Uint8Array<ArrayBuffer>]) : data
  return new Response(body, {
    headers: {
      'content-type': attachment.type,
      'content-length': String(attachment.size),
      'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      'content-security-policy': "sandbox; default-src 'none'",
      'x-content-type-options': 'nosniff',
      // An ID's bytes never change.
      'cache-control': 'private, max-age=31536000, immutable',
    },
  })
}

/** A method's input, from the request: its path's `:id`, its query, or its body, validated. */
async function inputOf(name: Method, request: Request, url: URL, param: string | null): Promise<unknown> {
  const id = param ?? ''
  const body = () => readJson(request)
  switch (name) {
    case 'me':
    case 'channels':
    case 'actors':
    case 'identity':
    case 'watchers':
      return {}
    case 'message':
    case 'delete':
    case 'cancelSchedule':
    case 'attachment':
      return { id }
    case 'messages':
      return MessagesQuery.parse(queryObject(url))
    case 'threads':
      return ThreadsQuery.parse(queryObject(url))
    case 'schedules':
      return SchedulesQuery.parse(queryObject(url))
    case 'matches':
      return MatchesQuery.parse(queryObject(url))
    case 'events': {
      const query = EventsQuery.parse(queryObject(url))
      // SSE's own resume header, when the client reconnects by itself.
      const last = request.headers.get('last-event-id')
      if (query.after === undefined && last && Ref.safeParse(last).success) query.after = last
      return query
    }
    case 'post':
      return PostBody.parse(await body())
    case 'schedule':
      return ScheduleBody.parse(await body())
    case 'register':
      return RegisterBody.parse(await body())
    case 'edit':
      return { id, ...EditBody.parse(await body()) }
    case 'react':
      return { id, ...ReactBody.parse(await body()) }
    case 'label':
      return { id, ...LabelBody.parse(await body()) }
    case 'typing':
      return { id, ...(TypingBody.parse(await body()) ?? {}) }
    case 'ack':
      return { id, ...AckBody.parse(await body()) }
    case 'upload': {
      const header = request.headers.get('x-board-filename')
      let name: string | null = null
      try {
        name = header === null ? null : decodeURIComponent(header)
      } catch {
        throw badRequest('`x-board-filename` is not URI-encoded')
      }
      return { data: await readCapped(request, ATTACHMENT_BYTES_MAX), name, type: request.headers.get('content-type') }
    }
  }
}

/**
 * A board for this project, on `backend`: `a2({ store, … })` keeps it in this deployment, and
 * `http(url)` uses another board that speaks the protocol. It serves the protocol over HTTP:
 * it routes and validates each request, verifies its token, works out who it writes as, and
 * calls the backend's method of the same name with that caller. Create it once, at module
 * scope, or one per tenant for a host.
 */
export function board(options: BoardOptions): Board {
  if ((options as { trustedSources?: unknown }).trustedSources !== undefined)
    throw new Error('board: trustedSources is now access: list vercelProject() and githubActions() rules there, each with can')
  const { backend } = options
  const host = typeof options.access === 'function' ? options.access : null
  if (host && options.auth) throw new Error('board: an access function replaces the built-in verifier, so drop `auth`')
  const watch = options.watch ?? {}
  const { verify, accessNow } = createVerifier({
    projectId: () => ownProjectId(options.project),
    teamId: () => ownTeamId(options.project),
    access: typeof options.access === 'function' ? [] : (options.access ?? []),
    ...(options.auth ? { auth: options.auth } : {}),
  })
  const streamMaxMs = options.streamMaxMs ?? 280_000
  const route = createRouter(backend.routes, options.basePath)
  /** The mount path, as the last request that reached a route had it. */
  let learned: string | null = null

  async function verified(request: Request, boardUrl: string): Promise<Principal> {
    if (host) {
      let result: Awaited<ReturnType<HostAccess>>
      try {
        result = await host(request)
      } catch (error) {
        // A thrown `Response` rejects like a returned one.
        if (error instanceof Response) throw new Rejected(error)
        throw error
      }
      if (result instanceof Response) throw new Rejected(result)
      return hostPrincipal(result)
    }
    const header = request.headers.get('authorization') ?? ''
    const token = header.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) throw unauthorized('missing bearer token')
    return verify(token, boardUrl, request.headers.get('x-vercel-oidc-token') ?? undefined)
  }

  async function authenticate(request: Request, boardUrl: string): Promise<Principal> {
    const principal = await verified(request, boardUrl)
    // Set by a proxy that holds the credential (Pi's sandbox); it only narrows.
    const scope = request.headers.get('x-board-scope')
    if (scope === null) return principal
    try {
      return { ...principal, access: principal.access.narrow(parseScope(scope)), scope }
    } catch (error) {
      throw badRequest((error as Error).message, 'invalid_scope')
    }
  }

  /** The verified caller of a request: its principal, and the actor it writes as. */
  async function callerOf(request: Request, boardUrl: string): Promise<Caller> {
    const principal = await authenticate(request, boardUrl)
    const { author, actor } = resolveActor(principal, request.headers, boardUrl)
    return { identity: { principal, author, actor }, origin: { via: { kind: 'api' } } }
  }

  /**
   * What a stored principal (a schedule's creator, a watcher's registrant) may do now, under
   * the rules as they are. Only under the verifier that made it: one from before the board
   * switched to or from a host's function is revoked rather than trusted. The board's own
   * code (`vboard:`, which a host's function can't return) works under either.
   */
  function accessFor(principal: Pick<Principal, 'id' | 'kind' | 'facts' | 'scope'>): Promise<Access | null> {
    return principal.id.startsWith('vboard:') || (principal.facts?.issuer === 'host') === (host !== null)
      ? accessNow(principal)
      : Promise.resolve(null)
  }

  /**
   * This board's own URL, where a board elsewhere wakes it: `url`, or on Vercel its production
   * domain (a preview's own URL there), and never a request's Host, which its sender chooses.
   */
  function ownUrl(): string | null {
    if (options.url) return options.url.replace(/\/+$/, '')
    const domain = process.env.VERCEL_ENV === 'production' ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_URL
    const base = options.basePath ?? learned
    return domain && base !== null ? `https://${domain}${base}`.replace(/\/+$/, '') : null
  }

  /** An in-process client through the board, as `caller`: its posts are idempotent per trigger. */
  function clientAs(caller: Caller, trigger: string | null): BoardClient {
    let writesMade = 0
    return createBoardClient({
      // Under the configured mount, so the router accepts the paths it builds.
      url: `http://in-process.board${(options.basePath ?? '').replace(/\/+$/, '')}`,
      token: 'in-process',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        let request = new Request(input, init)
        if (trigger !== null && request.method === 'POST' && new URL(request.url).pathname.endsWith('/messages')) {
          const body = ((await request.json()) ?? {}) as Record<string, unknown>
          body.id ??= await idempotentId('vboard-inbound', trigger, 'client', String(writesMade++))
          request = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(body) })
        }
        return dispatch(request, caller)
      }) as typeof fetch,
    })
  }

  const binding: BoardBinding = {
    watch: Object.fromEntries(Object.entries(watch).map(([id, watcher]) => [id, { tail: watcher.tail, when: watcher.when ?? 'matches' }])),
    async run(id, event, { trigger }) {
      const watcher = watch[id]
      if (!watcher) throw new Error(`this board has no watcher ${id}`)
      await watcher.run({ event, board: clientAs({ self: id, origin: { via: { kind: 'watcher', id } } }, trigger) })
    },
    accessFor,
    client: clientAs,
    url: ownUrl,
  }
  backend.bind(binding)

  /** Server-sent events, from the backend's long-poll: each event's `id` is its cursor, so `Last-Event-ID` resumes exactly. */
  async function sse(caller: Caller, query: Protocol['events']['input'], request: Request): Promise<Response> {
    // The first page now, so a bad cursor or a refusal answers as an error instead of a stream.
    const first = await backend.events(caller, { ...query, wait: 0 }, request.signal)
    const encoder = new TextEncoder()
    const controller = new AbortController()
    const deadline = Date.now() + streamMaxMs
    const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(streamMaxMs)])
    const body = new ReadableStream<Uint8Array>({
      async start(stream) {
        const send = (text: string) => {
          try {
            stream.enqueue(encoder.encode(text))
          } catch {}
        }
        const ping = setInterval(() => send(': ping\n\n'), 15_000)
        try {
          send(': connected\n\n')
          let page = first
          let after: string | undefined
          for (;;) {
            for (const event of page.events) send(`id: ${event.cursor}\nevent: board\ndata: ${JSON.stringify(event)}\n\n`)
            // Filtered-out events still advance the client's cursor with a bare `id:`, the first page's included.
            if (page.cursor !== (page.events.at(-1)?.cursor ?? after)) send(`id: ${page.cursor}\n\n`)
            after = page.cursor
            const left = deadline - Date.now()
            if (signal.aborted || left <= 0) break
            page = await backend.events(caller, { ...query, after, wait: Math.min(300, left / 1000) }, signal)
          }
        } catch (error) {
          if (!signal.aborted) console.error('[vboard] feed failed', error)
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

  async function dispatch(request: Request, injected: Caller | null): Promise<Response> {
    try {
      const url = new URL(request.url)
      const match = route(request.method, url.pathname)
      if (!match) throw notFound(`no route: ${request.method} ${url.pathname}`)
      const { target } = match
      if (!injected && !(target.kind === 'board' && target.name === 'discovery')) learned = match.base
      const boardUrl = (options.url ?? `${url.origin}${match.base}`).replace(/\/+$/, '')

      if (target.kind === 'board') {
        if (target.name === 'avatar') {
          const name = match.param ?? ''
          if (!(KNOWN_AGENTS as readonly string[]).includes(name)) throw notFound(`no avatar: ${name}`)
          return new Response(avatarSvg(name), {
            headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' },
          })
        }
        if (target.name === 'openapi') return json(openapi())
        const identity = await discoveryIdentity(request, options.project)
        const body: Discovery = {
          version: VERSION,
          url: boardUrl,
          audience: boardUrl,
          team_id: identity.teamId,
          project_id: identity.projectId,
          sync: backend.sync.map(({ key, platform }) => ({ key, platform })),
          ...(backend.remote !== null ? { remote: backend.remote } : {}),
        }
        return json(body)
      }

      if (target.kind === 'backend') {
        const caller = injected ?? (target.route.auth ? await callerOf(request, boardUrl) : null)
        return await target.route.handle(request, { caller, param: match.param })
      }

      const method = backend[target.name] as unknown
      if (typeof method !== 'function') throw notFound(`no route: ${request.method} ${url.pathname}`)
      const caller = injected ?? (await callerOf(request, boardUrl))
      const input = await inputOf(target.name, request, url, match.param)
      if (target.name === 'events' && (request.headers.get('accept') ?? '').includes('text/event-stream'))
        return await sse(caller, input as Protocol['events']['input'], request)
      const output = await (method as (caller: Caller, input: unknown, signal: AbortSignal) => Promise<unknown>).call(backend, caller, input, request.signal)
      if (target.name === 'attachment') return attachmentResponse(output as Protocol['attachment']['output'])
      return json(output, CREATED.has(target.name) ? 201 : 200)
    } catch (error) {
      if (error instanceof Rejected) return error.response
      return toErrorResponse(error)
    }
  }

  const handle = (request: Request) => dispatch(request, null)
  return {
    GET: handle,
    POST: handle,
    fetch: handle,
    client(name, clientOptions = {}) {
      const key = clientOptions.key === undefined ? null : `client:${name}:${clientOptions.key}`
      return clientAs({ self: name, origin: { via: { kind: 'client', name } } }, key)
    },
  }
}
