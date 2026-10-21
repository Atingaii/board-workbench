import { createHash } from 'node:crypto'
import { routes, type MatchView, type RegistrationView } from '../api/routes.ts'
import type { Method, Protocol } from '../api/protocol.ts'
import { BoardError, type BoardClient } from '../client/client.ts'
import { createClient } from '../client/node.ts'
import type { Attachment } from '../contract/schemas.ts'
import { SYNC, type Backend, type BackendRoute, type BoardBinding, type Caller, type ProtocolMethods } from './backend.ts'
import { HttpError, json } from './errors.ts'
import { watchersHash, type WatcherSpec } from './registry.ts'
import { METHODS } from './routing.ts'
import { compileWatcher } from './watch.ts'

export type HttpOptions = {
  /** How requests reach the board. Defaults to `fetch`; tests route them themselves. */
  fetch?: typeof fetch
  /** A token whose audience is the board's URL. Defaults to what the SDK finds: on Vercel, the deployment's. */
  token?: () => Promise<string>
  /**
   * Forwards requests to this board to the remote: what to merge into each request a caller's
   * call makes there, such as a token you mint for it. Without it, only this deployment's own
   * code calls the remote, and a request here answers 404 `remote`.
   */
  init?: (context: { caller: Caller }) => RequestInit | Promise<RequestInit>
}

/** A watcher's or client's name is the profile its writes are by. */
const PROFILE = /^[A-Za-z][A-Za-z0-9-]{0,31}$/
const PROFILE_RULE = 'ids start with a letter and use up to 32 letters, numbers, and hyphens'

/** `idempotentId`'s shape, a UUIDv8: the IDs board() derives for an in-process client's posts. */
const DERIVED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Registering again this soon after the same registration only repeats it. */
const REGISTER_EVERY_MS = 10_000
/** How long one wake-up runs matches before it leaves the rest to the next. */
const DRAIN_MS = 4 * 60_000
/** A pull with nothing to hand out holds this long, when the board pulls on its own. */
const POLL_WAIT_S = 25

const describe = (error: unknown) => ((error instanceof Error ? error.message : String(error)) || 'unknown error').slice(0, 500)

/** The SDK's error, as the board answers it: the remote's own status and code, or 502 when it never answered. */
const rethrow = (error: unknown): never => {
  if (error instanceof BoardError) throw new HttpError(error.status >= 400 ? error.status : 502, error.code, error.message)
  throw error
}

/** A parsed input, back on the wire as a query string. */
function queryString(input: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    // A flag left off is false: `all=false` would read as true.
    if (value === undefined || value === null || value === false) continue
    // Label filters parse to `[key, values | null]`.
    if (key === 'label' && Array.isArray(value))
      for (const [name, values] of value as [string, string[] | null][]) params.append('label', values === null ? name : `${name}=${values.join('|')}`)
    else if (Array.isArray(value)) for (const item of value) params.append(key, String(item))
    else params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

/** A file the remote served, as the board stored it: its headers say what it is. */
function attachmentOf(id: string, response: Response): Protocol['attachment']['output'] {
  const disposition = response.headers.get('content-disposition') ?? ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1]
  let name = 'file'
  try {
    if (encoded) name = decodeURIComponent(encoded)
  } catch {}
  const attachment: Attachment = {
    id,
    name,
    type: response.headers.get('content-type') ?? 'application/octet-stream',
    size: Number(response.headers.get('content-length') ?? 0),
  }
  return { attachment, data: response.body ?? new Uint8Array() }
}

/**
 * Another board that speaks the protocol, at `url`: this board keeps nothing, and this
 * deployment reads and writes that one as itself. Its watchers' tails are registered there.
 * The remote wakes it when one matches, with nothing in the wake-up but a hash, and it pulls
 * what matched with its own credentials, runs it, and acks it. When it can't be woken (no
 * https URL of its own: a dev server, say), it pulls on its own.
 */
export function http(url: string, options: HttpOptions = {}) {
  if (!/^https?:\/\/[^/]/.test(url)) throw new Error(`http: ${url} isn't a URL: pass the board's, like https://board.example.com/api/board`)
  const remote = url.replace(/\/+$/, '')
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init))
  let binding: BoardBinding | null = null
  const specs: Record<string, WatcherSpec> = {}
  /** Whether this board's sync subscribes too. */
  let syncing = false
  let hash = watchersHash(specs)
  const bound = () => {
    if (!binding) throw new Error("http: this backend isn't serving a board yet: pass it to board({ backend })")
    return binding
  }

  /** The SDK against the remote, as this deployment with `profile`, each request through `fetch`. */
  const sdk = (profile: string | null, fetch: typeof globalThis.fetch) =>
    createClient({
      url: remote,
      profile,
      session: null,
      handle: null,
      person: null,
      fetch,
      // Otherwise the SDK finds one, as it would anywhere: on Vercel, the deployment's.
      ...(options.token ? { token: options.token } : {}),
    })

  const own = sdk(null, doFetch)
  const profiles = new Map<string, BoardClient>()
  /** This deployment as `profile`: a client's name, or a watcher's ID. */
  function asProfile(profile: string): BoardClient {
    if (!PROFILE.test(profile)) throw new HttpError(400, 'invalid_request', `client: ${profile}: names start with a letter and use up to 32 letters, numbers, and hyphens`)
    let client = profiles.get(profile)
    if (!client) profiles.set(profile, (client = sdk(profile, doFetch)))
    return client
  }

  /** The client a caller's call goes through: this deployment's own, or one `init` takes over. Sync's is the deployment itself. */
  async function clientOf(caller: Caller): Promise<BoardClient> {
    if ('self' in caller) return caller.origin.via?.kind === 'engine' ? own : asProfile(caller.self)
    if (!options.init) throw new HttpError(404, 'remote', `${bound().url() ?? 'this board'} keeps no log: use ${remote}`)
    const init = await options.init({ caller })
    return sdk(null, (input, request = {}) => {
      const headers = new Headers(request.headers)
      for (const [name, value] of new Headers(init.headers)) headers.set(name, value)
      return doFetch(input, { ...request, ...init, headers })
    })
  }

  let principal: Promise<string> | null = null
  /** This deployment's principal on the remote, asked once. */
  const self = () =>
    (principal ??= own
      .me()
      .then((me) => me.principal)
      .catch((error) => {
        principal = null
        throw error
      }))
  /**
   * A post's ID, from the one board() derived for it, under this deployment's own principal: the
   * remote takes a `key:<principal>:` ID only from that principal, so no one can post with it first.
   */
  const keyId = async (derived: string) =>
    `key:${await self()}:${createHash('sha256').update(`vboard-key\u001f${derived}`).digest('hex').slice(0, 32)}`

  /** One protocol call on the remote, as `client`: the same route, with the input back on the wire. */
  async function call(client: BoardClient, method: Method, input: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const route = routes[method]
    // Each `:name` in the path is the input's field of that name; the rest are the query or the body.
    const fields = { ...input }
    const path = route.path.replace(/:(\w+)/g, (_, name: string) => {
      const value = fields[name]
      delete fields[name]
      return encodeURIComponent(String(value))
    })
    let response: Response
    if (method === 'upload') {
      const { data, name, type } = input as Protocol['upload']['input']
      response = await client
        .request(path, {
          method: 'POST',
          body: data as Uint8Array<ArrayBuffer>,
          headers: { ...(type ? { 'content-type': type } : {}), ...(name !== null ? { 'x-board-filename': encodeURIComponent(name) } : {}) },
          signal,
        })
        .catch(rethrow)
    } else if (route.method === 'GET') response = await client.request(`${path}${queryString(fields)}`, { signal }).catch(rethrow)
    else
      response = await client
        .request(path, { method: 'POST', body: new TextEncoder().encode(JSON.stringify(fields)), headers: { 'content-type': 'application/json' }, signal })
        .catch(rethrow)
    if (response.ok) return response
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } }
      if (body.error?.message) throw new HttpError(response.status, body.error.code ?? 'error', body.error.message)
    } catch (error) {
      if (error instanceof HttpError) throw error
    }
    throw new HttpError(502, 'remote_error', `${remote} answered ${response.status}`)
  }

  const methods = Object.fromEntries(
    METHODS.map((method) => [
      method,
      async (caller: Caller, input: Record<string, unknown>, signal: AbortSignal) => {
        start()
        const client = await clientOf(caller)
        // A post board() gave an ID derived from a trigger: the remote takes it as this deployment's key,
        // and a retry's lookup asks for the same.
        if ((method === 'post' || method === 'posted') && 'self' in caller && typeof input.id === 'string' && DERIVED_ID.test(input.id))
          input = { ...input, id: await keyId(input.id).catch(rethrow) }
        const response = await call(client, method, input, signal)
        return method === 'attachment' ? attachmentOf(String(input.id), response) : response.json()
      },
    ]),
  ) as unknown as ProtocolMethods

  /** Only an https URL can be woken; anything else pulls on its own. */
  const wakeable = (here: string | null) => (here?.startsWith('https://') ? here : null)

  let last: { url: string | null; at: number; result: RegistrationView } | null = null
  let registering: Promise<RegistrationView> | null = null
  /** Registers this board's watchers with the remote, as itself, replacing its last registration. */
  function register(here: string | null): Promise<RegistrationView> {
    if (last && last.url === here && last.result.hash === hash && Date.now() - last.at < REGISTER_EVERY_MS) return Promise.resolve(last.result)
    registering ??= own
      .register({ url: here, watch: specs, ...(syncing ? { sync: true } : {}) })
      .then((result) => {
        last = { url: here, at: Date.now(), result }
        return result
      })
      .finally(() => {
        registering = null
      })
    return registering
  }

  /** Runs one match and acks it: done, its error, or a skip for a watcher this board no longer has. */
  async function runOne(match: MatchView) {
    let outcome: { error?: string; skip?: boolean } = {}
    if (!bound().subscriptions[match.watcher]) outcome = { skip: true }
    else
      try {
        await bound().run(match.watcher, match.event, { trigger: `watch:${match.watcher}:${match.id}`, attempt: match.attempt + 1 })
      } catch (error) {
        console.error(`[vboard] watcher ${match.watcher} failed:`, error)
        outcome = { error: describe(error) }
      }
    // A lease that ran out was pulled again: that pull's ack is the one that counts.
    await own.ack(match.id, { lease: match.lease, ...outcome }).catch((error) => console.error(`[vboard] couldn't ack a match:`, describe(error)))
  }

  /**
   * Pulls and runs what's matched until nothing's left, or this run's time is up, and what sync
   * queued in its inbox. A thread's matches come one at a time.
   */
  async function drain(): Promise<number> {
    let ran = 0
    const until = Date.now() + DRAIN_MS
    while (Date.now() < until) {
      const matches = await own.matches({ limit: 10 })
      if (matches.length === 0) break
      // Each is a different watcher's or thread's oldest, so they run side by side.
      await Promise.all(matches.map(runOne))
      ran += matches.length
    }
    // An inbox event whose wait after an error is over: what woke this board may be it.
    return ran + (await bound().pull())
  }

  let polling: AbortController | null = null
  /** For a board that can't be woken: pulls on its own, each pull held open until something matches. */
  function poll() {
    if (polling) return
    const controller = (polling = new AbortController())
    void (async () => {
      for (let pause = 1000; !controller.signal.aborted; ) {
        try {
          await register(null)
          const matches = await own.matches({ limit: 10, wait: POLL_WAIT_S, signal: controller.signal })
          await Promise.all(matches.map(runOne))
          // Sync's inbox too: an event that failed tries again once its wait is over.
          await bound().pull()
          pause = 1000
        } catch (error) {
          if (controller.signal.aborted) break
          console.error(`[vboard] couldn't pull matches from ${remote}:`, describe(error))
          await new Promise((resolve) => setTimeout(resolve, pause))
          pause = Math.min(pause * 2, 60_000)
        }
      }
    })()
  }

  let started = false
  /**
   * On first use, a board with watchers registers them if it knows its URL. One on Vercel learns
   * its mount path from a request (a `POST /watchers`, or a wake-up); one that can't be woken pulls instead.
   */
  function start() {
    if (started || (Object.keys(specs).length === 0 && !syncing)) return
    const here = wakeable(bound().url())
    if (here) {
      started = true
      void register(here).catch((error) => console.error(`[vboard] couldn't register with ${remote}:`, describe(error)))
    } else if (process.env.VERCEL !== '1') {
      started = true
      poll()
    }
  }

  const routesHere: BackendRoute[] = [
    {
      // Nothing in a wake-up is trusted: it only says to pull, and what's pulled comes with this board's own credentials.
      method: 'POST',
      path: '/wake',
      auth: false,
      async handle(request) {
        started = true
        if (request.headers.get('x-board-watchers') !== hash) await register(wakeable(bound().url())).catch(rethrow)
        return json({ ran: await drain().catch(rethrow) })
      },
    },
    {
      // Anyone may ask: it sends this board's own watchers, with this board's own credentials.
      method: 'POST',
      path: '/watchers',
      auth: false,
      async handle() {
        started = true
        const here = wakeable(bound().url())
        const registration = await register(here).catch(rethrow)
        if (!here) poll()
        return json(registration)
      },
    },
  ]

  const backend = {
    ...methods,
    /** With `init`, requests here are forwarded, so discovery names no other board. */
    remote: options.init ? null : remote,
    routes: routesHere,
    bind(next: BoardBinding) {
      if (binding) throw new Error('http: this backend already serves a board: create one http() per board()')
      for (const [id, spec] of Object.entries(next.subscriptions)) {
        // Sync subscribes as itself, beside the watchers: the remote sends it what it may sync.
        if (spec.kind === 'sync') {
          syncing = id === SYNC
          continue
        }
        if (!PROFILE.test(id)) throw new Error(`watch ${id}: ${PROFILE_RULE}`)
        compileWatcher(id, spec)
        specs[id] = { tail: spec.tail, when: spec.when }
      }
      hash = watchersHash(specs, syncing)
      binding = next
    },
    /** Registers this board's watchers with the board it uses now, as `POST /watchers` does. */
    register: () => register(wakeable(bound().url())),
    /** Stops pulling, for a board that pulls on its own. */
    close: () => {
      polling?.abort()
      polling = null
    },
  }
  return backend satisfies Backend
}

export type HttpBackend = ReturnType<typeof http>
