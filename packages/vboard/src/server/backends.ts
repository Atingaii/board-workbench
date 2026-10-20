import { createHash } from 'node:crypto'
import type { Discovery } from '../api/routes.ts'
import type { BoardClient } from '../client/client.ts'
import { createClient } from '../client/node.ts'
import { VERSION } from '../version.ts'
import { a2Board, route, type A2Options, type BoardSetup } from './board.ts'
import { HttpError, json, notFound, toErrorResponse } from './errors.ts'
import { discoveryIdentity } from './identity.ts'

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

/** The options a2() takes, each a mistake at the top level now. */
const A2_OPTIONS = ['store', 'scheduler', 'access', 'sync', 'middleware', 'project', 'auth', 'streamMaxMs', 'blob'] as const

/**
 * A board for this project, on `backend`: `a2({ store, … })` keeps it in this deployment, and
 * `http(url)` uses another board that speaks the protocol.
 */
export function board<R extends BoardRuntime>(options: BoardOptions<R>): Board<R> {
  const given = options as Record<string, unknown>
  if (given.remote !== undefined) throw new Error("board: remote is now a backend: board({ backend: http('<url>') })")
  if (given.trustedSources !== undefined)
    throw new Error('board: trustedSources is now access, in a2(): list vercelProject() and githubActions() rules there, each with can')
  const misplaced = A2_OPTIONS.filter((key) => given[key] !== undefined)
  if (misplaced.length > 0)
    throw new Error(`board: ${misplaced.join(', ')} ${misplaced.length === 1 ? 'goes' : 'go'} in a2(): board({ backend: a2({ ${misplaced.join(', ')} }) })`)
  if (!options.backend) throw new Error('board: no backend: pass a2({ store, … }) to keep the board here, or http(url) to use one elsewhere')
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

/** A board that keeps nothing: discovery here names `remote`, and everything else is the remote's. */
function httpBoard(remote: string, options: HttpOptions, setup: BoardSetup) {
  if (setup.watch && Object.keys(setup.watch).length > 0)
    throw new Error("board: watchers don't run over http() yet: keep them on an a2() board for now")
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

  async function fetchHere(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      const match = route(request.method, url.pathname, setup.basePath)
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
  }
}
