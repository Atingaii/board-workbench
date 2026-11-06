import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { vi, expect } from 'vitest'
import { memory } from '../src/store/memory.ts'
import { createBoard, type Board, type BoardOptions } from '../src/server/board.ts'
import type { Serving } from '../src/server/policy.ts'
import { a2, type A2Options } from '../src/server/a2.ts'
import { memoryBlob } from '../src/server/blob.ts'
import { local } from '../src/local/index.ts'
import { oidcTokens, type OidcTokensOptions } from '../src/access/index.ts'

export const BOARD_URL = 'http://board.test/api/board'
export const PROJECT_ID = 'prj_board'
export const TEAM_ID = 'team_test'
export const VERCEL_ISS = 'https://oidc.vercel.com/test'
export const GITHUB_ISS = 'https://token.actions.githubusercontent.com'
/** Some other OIDC issuer, for `oidc()`. */
export const OIDC_ISS = 'https://gitlab.test'

const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' }
const jwks = createLocalJWKSet({ keys: [jwk] })
/** The test issuers' public keys, as an issuer's `jwks_uri` serves them. */
export const testKeys = { keys: [jwk] }

/** The test issuers, to combine with other auth options. */
export const testAuth = {
  vercel: { issuer: VERCEL_ISS, jwks },
  github: { issuer: GITHUB_ISS, jwks },
  oidc: { [OIDC_ISS]: jwks },
}

/**
 * A clock that keeps real time and can skip ahead. A2 holds a failed event back
 * before retrying it (one second, doubling to 30) by its store's clock, so a
 * test that drives retries skips the hold instead of waiting it out.
 */
export function testClock() {
  let ahead = 0
  return {
    now: () => new Date(Date.now() + ahead),
    /** Past any retry hold. */
    skip: (ms = 30_000) => void (ahead += ms),
  }
}

/**
 * Where these tests' boards run: in the test project (`PROJECT_ID`, on `TEAM_ID`), as a board
 * deployed in it finds itself in its environment, with nothing read from disk.
 */
const environment = async (): Promise<Serving> => ({
  oidcTokens: (await import('../src/server/serving.ts')).oidcTokens,
  ownProjectId: async () => PROJECT_ID,
  ownTeamId: async () => TEAM_ID,
  discoveryIdentity: async () => ({ projectId: PROJECT_ID, teamId: TEAM_ID }),
})

/** `board()`, as a deployment of the test project runs it. Tests pass the backend. */
export function board(options: BoardOptions): Board {
  return createBoard(options, {
    backend: () => {
      throw new Error('a test passes board() its backend')
    },
    sync: () => import('../src/sync/engine.ts'),
    serving: environment,
  })
}

/**
 * board()'s options and the local board engine's, side by side, as tests write them. `auth` is
 * `oidcTokens()`'s options, for board()'s `authenticate`. Without a store, it's one in memory.
 */
export type MountOptions = Partial<A2Options> & Omit<BoardOptions, 'backend' | 'fetch'> & { auth?: OidcTokensOptions }

/** A board on the local board's engine: each option to the one that takes it. It has the engine's extras, for tests to look inside. */
export function mount(options: MountOptions) {
  const { store, scheduler, blob, transport, auth, ...rest } = options
  const backend = a2({ store: store ?? memory(), ...(scheduler ? { scheduler } : {}), ...(blob ? { blob } : {}), ...(transport ? { transport } : {}) })
  const { url, ...given } = rest
  const created = board({
    ...given,
    backend,
    ...(!rest.authenticate && auth ? { authenticate: oidcTokens(auth) } : {}),
    ...('url' in options ? { url } : {}),
  })
  // Read when a test asks.
  const lazy = (read: () => unknown) => ({ get: read, enumerable: true })
  return Object.defineProperties(Object.assign(created, { backend, scheduler: backend.scheduler }), {
    servers: lazy(() => backend.servers),
    session: lazy(() => backend.session),
    store: lazy(() => backend.store),
  }) as typeof created & { backend: typeof backend; scheduler: typeof backend.scheduler } & Pick<typeof backend, 'servers' | 'session' | 'store'>
}

/**
 * A board on a memory store, with its files in memory, whose tokens come from a local test issuer.
 * It has no scheduler unless a test passes one, and `blob: undefined` keeps no files.
 */
export function testBoard(options: MountOptions = {}) {
  const clock = testClock()
  const store = memory({ clock })
  const created = mount({
    store,
    blob: memoryBlob(),
    auth: testAuth,
    ...options,
    // `url: undefined` lets the board infer its URL from requests, as the CLI's tests do.
    url: 'url' in options ? options.url : BOARD_URL,
  })
  /**
   * Lets a failed event's next attempt run now, once no attempt is running on
   * `session`: skipping past a running attempt's claim would let a drain take it
   * over, and run the event twice at once.
   */
  const skipHold = async (server: { contract: { name: string } }, session: string) => {
    // Skipping the clock lapses every claim in the store, so nothing may be running on the board either:
    // a delivery in flight there would be taken over, and post twice.
    const sessions = [`${server.contract.name}\u001f${session}`, 'board\u001fboard']
    await vi.waitFor(async () => {
      for (const at of sessions) {
        const cursors = await store.log.cursors(at)
        expect(cursors.filter((cursor) => cursor.claimHolder !== null)).toEqual([])
      }
    })
    clock.skip()
  }
  return Object.assign(created, { clock, skipHold })
}

/**
 * A board as `local({ memory: true })` keeps one, with its scheduler in this process, whose tokens
 * come from a local test issuer: what a test that needs only a board, end to end, runs against.
 */
export function localBoard(options: Omit<BoardOptions, 'backend' | 'fetch'> & { auth?: OidcTokensOptions } = {}) {
  const { auth, url, ...rest } = options
  const backend = local({ memory: true })
  const created = board({
    ...rest,
    backend,
    authenticate: rest.authenticate ?? oidcTokens(auth ?? testAuth),
    // `url: undefined` lets the board infer its URL from requests, as the CLI's tests do.
    ...('url' in options ? (url !== undefined ? { url } : {}) : { url: BOARD_URL }),
  })
  return Object.assign(created, { close: () => backend.close() })
}

async function sign(claims: Record<string, unknown>, issuer: string, audience = BOARD_URL) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)
}

/** A person: a development token for the board's own project. */
export const personToken = (userId = 'u_julian', audience?: string) =>
  sign(
    {
      sub: `owner:test:project:board:environment:development`,
      owner: 'test',
      owner_id: TEAM_ID,
      project: 'board',
      project_id: PROJECT_ID,
      environment: 'development',
      user_id: userId,
    },
    VERCEL_ISS,
    audience,
  )

/** A deployment of some Vercel project. */
export const deploymentToken = (
  project = 'marketing',
  projectId = 'prj_marketing',
  environment = 'production',
  options: { teamId?: string; audience?: string } = {},
) =>
  sign(
    {
      sub: `owner:test:project:${project}:environment:${environment}`,
      owner: 'test',
      owner_id: options.teamId ?? TEAM_ID,
      project,
      project_id: projectId,
      environment,
    },
    VERCEL_ISS,
    options.audience,
  )

/** A GitHub Actions run. */
export const workflowToken = (claims: Record<string, unknown> = {}) =>
  sign(
    {
      repository: 'basehub-ai/www',
      repository_id: '123456',
      event_name: 'push',
      ref: 'refs/heads/main',
      workflow_ref: 'basehub-ai/www/.github/workflows/deploy.yml@refs/heads/main',
      ...claims,
    },
    GITHUB_ISS,
  )

/** A token from another OIDC issuer, GitLab's shape by default. */
export const oidcToken = (claims: Record<string, unknown> = {}, issuer = OIDC_ISS) =>
  sign({ sub: 'project_path:acme/api:ref_type:branch:ref:main', project_path: 'acme/api', ref: 'main', ...claims }, issuer)

/**
 * A config home where Julian is signed in to each board in `audiences`, as `vercel login` leaves
 * it: a token cached for each, so the Node client mints none. Pass it as `XDG_CONFIG_HOME`.
 */
export async function signedInHome(audiences: string[], userId = 'u_julian') {
  const home = await mkdtemp(join(tmpdir(), 'board-tokens-'))
  await mkdir(join(home, 'board', 'tokens'), { recursive: true })
  for (const audience of audiences) {
    const token = await personToken(userId, audience)
    const file = join(home, 'board', 'tokens', `${createHash('sha256').update(audience).digest('hex').slice(0, 32)}.json`)
    await writeFile(file, JSON.stringify({ token, expiresAt: Date.now() + 3_600_000, handle: 'julian', name: 'Julian', avatar: null }))
  }
  return home
}

/** Calls the board in-process, like a client would over HTTP. */
export function caller(handler: (request: Request) => Promise<Response>, token: string, headers: Record<string, string> = {}) {
  return async (method: string, path: string, body?: unknown) => {
    const response = await handler(
      new Request(`${BOARD_URL}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }
}

/**
 * A deployment's own fetch, as `http(url, { fetch })` takes it: `fetch`, with a bearer token on
 * each request that brings none.
 */
export function bearer(
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  token: string | (() => string | Promise<string>),
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${typeof token === 'function' ? await token() : token}`)
    return fetch(input, { ...init, headers })
  }) as typeof globalThis.fetch
}
