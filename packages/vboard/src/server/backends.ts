import { createHash } from 'node:crypto'
import type { BoardEventView, Discovery, MatchView, RegistrationView } from '../api/routes.ts'
import type { BoardClient } from '../client/client.ts'
import { createClient } from '../client/node.ts'
import { VERSION } from '../version.ts'
import { a2Board, route, type A2Options, type BoardSetup } from './board.ts'
import { HttpError, json, notFound, toErrorResponse } from './errors.ts'
import { discoveryIdentity } from './identity.ts'
import { watchersHash, type WatcherSpec } from './registry.ts'
import { compileWatcher } from './watch.ts'

/** What a backend runs for `board()`: the requests it answers here, and a client for your server code. */
export type BoardRuntime = {
  fetch(request: Request): Promise<Response>
  /** The scheduler's callback, for a backend that keeps the board here. Elsewhere it answers 404. */
  scheduler(request: Request): Promise<Response>
  /** A client for your own server code, writing as `name`. With a `key`, its posts are idempotent. */
  client(name: string, options?: { key?: string }): BoardClient
}

/** Where the board lives: `a2()` keeps it in this deployment, `http(url)` uses one that speaks the protocol. */
export type Backend<R extends BoardRuntime = BoardRuntime> = {
  readonly kind: string
  /** Starts the board on this backend, with the watchers that run in this project. */
  start(setup: BoardSetup): R
}

export type BoardOptions<R extends BoardRuntime = BoardRuntime> = BoardSetup & { backend: Backend<R> }

export type Board<R extends BoardRuntime = BoardRuntime> = R & {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

/**
 * A board for this project, on `backend`: `a2({ store, … })` keeps it in this deployment, and
 * `http(url)` uses another board that speaks the protocol.
 */
export function board<R extends BoardRuntime>(options: BoardOptions<R>): Board<R> {
  const { backend, ...setup } = options
  const runtime = backend.start(setup)
  return Object.assign(runtime, { GET: runtime.fetch, POST: runtime.fetch })
}

/** The board in this deployment, on A2's log: its store, scheduler, sync, access, and the rest. */
export function a2(options: A2Options = {}): Backend<ReturnType<typeof a2Board>> {
  return { kind: 'a2', start: (setup) => a2Board({ ...options, ...setup }) }
}

export type HttpOptions = {
  /** How requests reach the board. Defaults to `fetch`; tests route them themselves. */
  fetch?: typeof fetch
  /** A token whose audience is the board's URL. Defaults to what the SDK finds: on Vercel, the deployment's. */
  token?: () => Promise<string>
}

/** Another board that speaks the protocol, at `url`: this project reads and writes it as itself. */
export function http(url: string, options: HttpOptions = {}): Backend<ReturnType<typeof httpBoard>> {
  if (!/^https?:\/\/[^/]/.test(url)) throw new Error(`http: ${url} isn't a URL: pass the board's, like https://board.example.com/api/board`)
  const remote = url.replace(/\/+$/, '')
  return { kind: 'http', start: (setup) => httpBoard(remote, options, setup) }
}

/** A watcher's or client's name is the profile its writes are by. */
const PROFILE = /^[A-Za-z][A-Za-z0-9-]{0,31}$/
const PROFILE_RULE = 'ids start with a letter and use up to 32 letters, numbers, and hyphens'

/** Registering again this soon after the same registration only repeats it. */
const REGISTER_EVERY_MS = 10_000
/** How long one wake-up runs matches before it leaves the rest to the next. */
const DRAIN_MS = 4 * 60_000
/** A pull with nothing to hand out holds this long, when the board pulls on its own. */
const POLL_WAIT_S = 25

const describe = (error: unknown) => ((error instanceof Error ? error.message : String(error)) || 'unknown error').slice(0, 500)

/**
 * A board that keeps nothing: discovery here names `remote`, and everything else is the remote's.
 * Its watchers' tails are registered there. The remote wakes it when one matches, with nothing in
 * the wake-up but a hash, and it pulls what matched with its own credentials, runs it, and acks it.
 * When it can't be woken (no https URL of its own: a dev server, say), it pulls on its own.
 */
function httpBoard(remote: string, options: HttpOptions, setup: BoardSetup) {
  const watch = setup.watch ?? {}
  const specs: Record<string, WatcherSpec> = {}
  for (const [id, watcher] of Object.entries(watch)) {
    if (!PROFILE.test(id)) throw new Error(`watch ${id}: ${PROFILE_RULE}`)
    compileWatcher(id, watcher)
    specs[id] = { tail: watcher.tail, when: watcher.when ?? 'matches' }
  }
  const hash = watchersHash(specs)
  const watching = Object.keys(specs).length > 0
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init))

  /** The SDK against the remote, as this deployment with `profile`. Posts get IDs derived from `key`. */
  function clientFor(profile: string | null, key: string | null): BoardClient {
    let posts = 0
    const keyed = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname
      if (key !== null && init.method === 'POST' && path.endsWith('/messages') && typeof init.body === 'string') {
        const body = JSON.parse(init.body) as Record<string, unknown>
        if (body.id === undefined) body.id = await keyId(key, posts++)
        init = { ...init, body: JSON.stringify(body) }
      }
      return doFetch(input, init)
    }) as typeof fetch
    return createClient({
      url: remote,
      profile,
      session: null,
      handle: null,
      person: null,
      fetch: keyed,
      // Otherwise the SDK finds one, as it would anywhere: on Vercel, the deployment's.
      ...(options.token ? { token: options.token } : {}),
    })
  }

  const own = clientFor(null, null)
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
   * A post's ID, derived from its client's key and its order, under this deployment's own principal:
   * the remote takes a `key:<principal>:` ID only from that principal, so no one can post with it first.
   */
  const keyId = async (key: string, n: number) =>
    `key:${await self()}:${createHash('sha256').update(`vboard-key\u001f${key}\u001f${n}`).digest('hex').slice(0, 32)}`

  /**
   * This board's own URL, where it's woken: `url` from setup, or on Vercel its production domain
   * (a preview's own URL there), and never from a request, whose Host its sender chooses.
   */
  function ownUrl(base: string | null): string | null {
    if (setup.url) return setup.url.replace(/\/+$/, '')
    const host = process.env.VERCEL_ENV === 'production' ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_URL
    return host && base !== null ? `https://${host}${base}`.replace(/\/+$/, '') : null
  }
  /** Only an https URL can be woken; anything else pulls on its own. */
  const wakeable = (url: string | null) => (url?.startsWith('https://') ? url : null)

  let last: { url: string | null; at: number; result: RegistrationView } | null = null
  let registering: Promise<RegistrationView> | null = null
  /** Registers this board's watchers with the remote, as itself, replacing its last registration. */
  function register(url: string | null): Promise<RegistrationView> {
    if (last && last.url === url && last.result.hash === hash && Date.now() - last.at < REGISTER_EVERY_MS) return Promise.resolve(last.result)
    registering ??= own
      .register({ url, watch: specs })
      .then((result) => {
        last = { url, at: Date.now(), result }
        return result
      })
      .finally(() => {
        registering = null
      })
    return registering
  }

  /** Runs one match and acks it: done, its error, or a skip for a watcher this board no longer has. */
  async function runOne(match: MatchView) {
    const watcher = watch[match.watcher]
    let outcome: { error?: string; skip?: boolean } = {}
    if (!watcher) outcome = { skip: true }
    else
      try {
        await watcher.run({ event: match.event as BoardEventView, board: clientFor(match.watcher, `watch:${match.watcher}:${match.id}`) })
      } catch (error) {
        console.error(`[vboard] watcher ${match.watcher} failed:`, error)
        outcome = { error: describe(error) }
      }
    // A lease that ran out was pulled again: that pull's ack is the one that counts.
    await own.ack(match.id, { lease: match.lease, ...outcome }).catch((error) => console.error(`[vboard] couldn't ack a match:`, describe(error)))
  }

  /** Pulls and runs what's matched until nothing's left, or this run's time is up. A thread's matches come one at a time. */
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
    return ran
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

  // A board that knows its URL registers when it starts. One on Vercel learns its mount path from
  // its first request: a `POST /watchers`, or a wake-up. One that can't be woken pulls instead.
  if (watching) {
    const url = wakeable(ownUrl(setup.basePath ?? null))
    if (url) void register(url).catch((error) => console.error(`[vboard] couldn't register with ${remote}:`, describe(error)))
    else if (process.env.VERCEL !== '1') poll()
  }

  async function fetchHere(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      const match = route(request.method, url.pathname, setup.basePath)
      if (match?.name === 'register') {
        // Anyone may ask: it sends this board's own watchers, with this board's own credentials.
        const here = wakeable(ownUrl(match.base))
        const registration = await register(here)
        if (!here) poll()
        return json(registration)
      }
      if (match?.name === 'wake') {
        // Nothing in a wake-up is trusted: it only says to pull, and what's pulled comes with this board's own credentials.
        const here = wakeable(ownUrl(match.base))
        if (request.headers.get('x-board-watchers') !== hash) await register(here)
        return json({ ran: await drain() })
      }
      if (match?.name !== 'discovery') throw new HttpError(404, 'remote', `this board keeps no log: use ${remote}`)
      const boardUrl = (setup.url ?? `${url.origin}${match.base}`).replace(/\/+$/, '')
      const identity = await discoveryIdentity(request, undefined)
      const body: Discovery = {
        version: VERSION,
        url: boardUrl,
        audience: boardUrl,
        team_id: identity.teamId,
        project_id: identity.projectId,
        sync: [],
        remote,
      }
      return json(body)
    } catch (error) {
      return toErrorResponse(error)
    }
  }

  return {
    fetch: fetchHere,
    scheduler: async (_request: Request) =>
      toErrorResponse(notFound('this board keeps no log, so it has no scheduler: its backend runs everything')),
    /**
     * A client for your own server code, writing to the remote as this deployment with `name` as
     * its profile. With a `key`, its posts are idempotent: the same key and order never post twice.
     */
    client(name: string, clientOptions: { key?: string } = {}): BoardClient {
      if (!PROFILE.test(name)) throw new Error(`client: ${name}: names start with a letter and use up to 32 letters, numbers, and hyphens`)
      return clientFor(name, clientOptions.key === undefined ? null : `client:${name}:${clientOptions.key}`)
    },
    /** The board this one uses. */
    remote,
    /** Registers this board's watchers with the board it uses now, as `POST /watchers` does. */
    register: () => register(wakeable(ownUrl(setup.basePath ?? null))),
    /** Stops pulling, for a board that pulls on its own. */
    close: () => {
      polling?.abort()
      polling = null
    },
  }
}
