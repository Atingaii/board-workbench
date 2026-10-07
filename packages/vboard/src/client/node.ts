import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { decodeJwt } from 'jose'
import { exchangeVercelOidcToken, getVercelOidcToken, getVercelToken } from '@vercel/oidc'
import type { Discovery } from '../api/routes.ts'
import {
  BoardError,
  createBoardClient,
  type BoardClient,
  type ClientOptions,
  type ProfileOption,
} from './client.ts'

export const configDir = () =>
  join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'vboard')

/** The board saved by `vboard use <url>`. */
export function savedUrl(): string | undefined {
  try {
    const { url } = JSON.parse(readFileSync(join(configDir(), 'config.json'), 'utf8')) as {
      url?: string
    }
    return url
  } catch {
    return undefined
  }
}

/**
 * A Git checkout's root: `.git` is a directory with a `HEAD`, or a worktree's
 * `gitdir:` file. A stray empty `.git` (say, in `~` or `/tmp`) isn't one.
 */
function isCheckout(directory: string): boolean {
  const git = join(directory, '.git')
  try {
    if (statSync(git).isDirectory()) return existsSync(join(git, 'HEAD'))
    return readFileSync(git, 'utf8').startsWith('gitdir:')
  } catch {
    return false
  }
}

export function projectDir(cwd = process.cwd()): string {
  let directory = resolve(cwd)
  while (true) {
    if (existsSync(join(directory, '.vboard', 'config.json')) || isCheckout(directory))
      return directory
    const parent = dirname(directory)
    if (parent === directory) return resolve(cwd)
    directory = parent
  }
}

export function projectUrl(): string | undefined {
  const path = join(projectDir(), '.vboard', 'config.json')
  let contents: string
  try {
    contents = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    const { url } = JSON.parse(contents)
    if (typeof url === 'string' && ['http:', 'https:'].includes(new URL(url).protocol)) return url
  } catch {}
  throw new BoardError('invalid_config', `invalid board link at ${path}: expected an http(s) url`, 0)
}

export type DetectedAgent = { profile: string; session: string | null }

/** Claude Code, Codex, and Grok sessions select their own profile, like Just Chat's CLI. */
export function detectAgent(env: NodeJS.ProcessEnv = process.env): DetectedAgent | null {
  const found: DetectedAgent[] = []
  if (env.CLAUDECODE === '1' || env.CLAUDE_CODE_SESSION_ID)
    found.push({ profile: 'claude', session: env.CLAUDE_CODE_SESSION_ID || null })
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID)
    found.push({ profile: 'codex', session: env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || null })
  if (env.GROK_SESSION_ID) found.push({ profile: 'grok', session: env.GROK_SESSION_ID })
  if (env.CURSOR_AGENT === '1') found.push({ profile: 'cursor', session: null })
  if (env.PI_CODING_AGENT === 'true' || env.AI_AGENT === 'pi') found.push({ profile: 'pi', session: env.PI_SESSION_ID || null })
  // AI_AGENT is a generic marker: any agent that sets it gets its own profile.
  const named = env.AI_AGENT?.trim().toLowerCase()
  if (named && /^[a-z][a-z0-9-]{0,31}$/.test(named) && !found.some((agent) => agent.profile === named))
    found.push({ profile: named, session: null })
  if (found.length > 1)
    throw new BoardError(
      'ambiguous_agent',
      `several agent environments detected (${found.map((a) => a.profile).join(', ')}): choose one with a profile, or none`,
      0,
    )
  return found[0] ?? null
}

const expiry = (token: string): number => {
  try {
    const { exp } = decodeJwt(token)
    return exp ? exp * 1000 : Date.now() + 5 * 60_000
  } catch {
    return Date.now() + 5 * 60_000
  }
}

type Cached = { token: string; expiresAt: number; handle?: string | null; name?: string | null; avatar?: string | null }

const cacheFile = (audience: string) =>
  join(configDir(), 'tokens', `${createHash('sha256').update(audience).digest('hex').slice(0, 32)}.json`)

async function readCache(audience: string): Promise<Cached | null> {
  try {
    const cached = JSON.parse(await readFile(cacheFile(audience), 'utf8')) as Cached
    return cached.expiresAt - 5 * 60_000 > Date.now() ? cached : null
  } catch {
    return null
  }
}

async function writeCache(audience: string, cached: Cached) {
  await mkdir(join(configDir(), 'tokens'), { recursive: true, mode: 0o700 })
  await writeFile(cacheFile(audience), JSON.stringify(cached), { mode: 0o600 })
}

/**
 * A person's token: their Vercel CLI login mints a development token for the
 * board's project, exchanged so its audience is the board's URL. Cached on
 * disk for its 12-hour life.
 */
async function personToken(discovery: Discovery): Promise<Cached> {
  const cached = await readCache(discovery.audience)
  // Tokens cached before names and avatars were kept get them once.
  if (cached && cached.name === undefined) {
    const user = await getVercelToken()
      .then(vercelUser)
      .catch(() => null)
    const filled = { ...cached, name: user?.name ?? null, avatar: user?.avatar ?? null }
    await writeCache(discovery.audience, filled).catch(() => {})
    return filled
  }
  if (cached) return cached
  if (!discovery.project_id)
    throw new BoardError('no_project', `the board at ${discovery.url} doesn't know its Vercel project`, 0)

  let development: string
  let authToken: string | null = null
  try {
    authToken = await getVercelToken()
    const response = await fetch(
      `https://api.vercel.com/v1/projects/${discovery.project_id}/token?source=vboard${
        discovery.team_id ? `&teamId=${discovery.team_id}` : ''
      }`,
      { method: 'POST', headers: { authorization: `Bearer ${authToken}` } },
    )
    if (response.status === 403 || response.status === 404)
      throw new BoardError(
        'no_access',
        "your Vercel account can't access this board's project: ask for access to it",
        response.status,
      )
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    development = ((await response.json()) as { token: string }).token
  } catch (error) {
    if (error instanceof BoardError) throw error
    development = await tokenFromVercelCli(discovery)
  }

  const token = await exchangeVercelOidcToken({ token: development, audience: discovery.audience })
  const user = authToken ? await vercelUser(authToken) : null
  const fresh: Cached = { token, expiresAt: expiry(token), handle: user?.handle ?? null, name: user?.name ?? null, avatar: user?.avatar ?? null }
  await writeCache(discovery.audience, fresh).catch(() => {})
  return fresh
}

/** When credentials live in the keychain, the Vercel CLI mints the token itself. */
async function tokenFromVercelCli(discovery: Discovery): Promise<string> {
  const args = ['project', 'token', discovery.project_id!, '--format=json']
  if (discovery.team_id) args.push('--scope', discovery.team_id)
  try {
    const { stdout } = await promisify(execFile)('vercel', args, { timeout: 30_000 })
    return (JSON.parse(stdout) as { token: string }).token
  } catch {
    throw new BoardError('not_logged_in', 'not signed in to Vercel: run `vercel login`', 0)
  }
}

/** Your Vercel username, display name, and avatar (Vercel serves avatars publicly). */
async function vercelUser(authToken: string): Promise<{ handle: string | null; name: string | null; avatar: string | null } | null> {
  try {
    const response = await fetch('https://api.vercel.com/v2/user', {
      headers: { authorization: `Bearer ${authToken}` },
    })
    if (!response.ok) return null
    const { user } = (await response.json()) as { user?: { username?: string; name?: string | null; avatar?: string | null } }
    return {
      handle: user?.username?.toLowerCase() ?? null,
      name: user?.name?.trim() || null,
      avatar: user?.avatar && /^[0-9a-f]+$/i.test(user.avatar) ? `https://vercel.com/api/www/avatar/${user.avatar}?s=128` : null,
    }
  } catch {
    return null
  }
}

async function githubActionsToken(audience: string): Promise<string> {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL!)
  url.searchParams.set('audience', audience)
  const response = await fetch(url, {
    headers: { authorization: `bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  })
  if (!response.ok)
    throw new BoardError(
      'no_token',
      `GitHub Actions refused an OIDC token (${response.status}): does the job have \`permissions: id-token: write\`?`,
      0,
    )
  return ((await response.json()) as { value: string }).value
}

export type NodeClientOptions = Partial<ClientOptions>

/**
 * A client with Node defaults: the URL from `VBOARD_URL`, the project link,
 * or the saved board, and a token from `VBOARD_TOKEN`, GitHub Actions, the Vercel
 * runtime, or your Vercel CLI login, in that order.
 */
export function createClient(options: NodeClientOptions = {}): BoardClient {
  const url = (options.url ?? process.env.VBOARD_URL ?? projectUrl() ?? savedUrl())?.replace(/\/+$/, '')
  if (!url)
    throw new BoardError('no_board', 'no board URL: run `vboard link <url>`, set VBOARD_URL, or run `vboard use <url>`', 0)
  const doFetch = guarded(url, options.fetch ?? globalThis.fetch)

  let discovery: Promise<Discovery> | undefined
  const discover = () =>
    (discovery ??= doFetch(url, { headers: bypassHeaders() }).then(async (response) => {
      if (!response.ok) throw new BoardError('no_board', `no board at ${url} (${response.status})`, response.status)
      return (await response.json()) as Discovery
    }))

  let cached: Cached | null = null
  let person: Promise<Cached> | null = null
  const mint = async (): Promise<Cached> => {
    if (process.env.VBOARD_TOKEN) {
      const token = process.env.VBOARD_TOKEN
      return { token, expiresAt: expiry(token) }
    }
    const audience = (await discover()).audience
    if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
      const token = await githubActionsToken(audience)
      return { token, expiresAt: expiry(token) }
    }
    if (process.env.VERCEL === '1') {
      const token = await getVercelOidcToken({ audience })
      return { token, expiresAt: expiry(token) }
    }
    person ??= discover().then(personToken).finally(() => {
      person = null
    })
    return person
  }
  const token = async () => {
    if (!cached || cached.expiresAt - 60_000 < Date.now()) cached = await mint()
    return cached.token
  }

  let agent: DetectedAgent | null | undefined
  const detected = () => (agent === undefined ? (agent = detectAgent()) : agent)

  const profile =
    options.profile !== undefined
      ? options.profile
      : (): ProfileOption => {
          const name = process.env.VBOARD_AS || detected()?.profile
          if (!name) return null
          const avatar = process.env.VBOARD_AVATAR
          return avatar ? { name, avatar } : name
        }

  return createBoardClient({
    url,
    token: options.token ?? token,
    profile,
    session: options.session !== undefined ? options.session : () => detected()?.session ?? null,
    handle:
      options.handle !== undefined
        ? options.handle
        : async () => {
            if (process.env.VBOARD_HANDLE) return process.env.VBOARD_HANDLE
            if (options.token !== undefined) return null
            await token()
            return cached?.handle ?? null
          },
    person:
      options.person !== undefined
        ? options.person
        : async () => {
            if (options.token !== undefined) return null
            await token()
            return cached ? { name: cached.name ?? null, avatar: cached.avatar ?? null } : null
          },
    headers: async () => ({
      ...bypassHeaders(),
      ...(options.headers ? await (typeof options.headers === 'function' ? options.headers() : options.headers) : {}),
    }),
    fetch: doFetch,
  })
}

export { BoardError, type BoardClient, type ClientOptions, type ProfileOption } from './client.ts'

/**
 * A board's fetch that recognizes Vercel Deployment Protection: a redirect to
 * `/sso-api`, or an HTML page where the board answers JSON (on SAML teams, the
 * redirects end at the IdP's login page with a 200). Other redirects of a GET
 * are followed. Attachments, which may be HTML, come with a `content-disposition`.
 */
function guarded(url: string, doFetch: typeof fetch): typeof fetch {
  const wall = (status: number) =>
    new BoardError(
      'protected',
      `${url} is behind Vercel Deployment Protection; set VERCEL_AUTOMATION_BYPASS_SECRET (Project → Settings → Deployment Protection → Protection Bypass for Automation)`,
      status,
    )
  return async (input, init = {}) => {
    let target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    for (let hops = 0; ; hops++) {
      const response = await doFetch(hops === 0 ? input : target, { ...init, redirect: 'manual' })
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
      if (location) {
        const next = new URL(location, target)
        if (next.pathname.startsWith('/sso-api')) throw wall(response.status)
        if ((method === 'GET' || method === 'HEAD') && hops < 10) {
          target = next.href
          continue
        }
      }
      if (/^text\/html\b/i.test(response.headers.get('content-type') ?? '') && !response.headers.has('content-disposition'))
        throw wall(response.status)
      return response
    }
  }
}

/** Gets past Vercel Deployment Protection on a protected board. */
function bypassHeaders(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  return secret ? { 'x-vercel-protection-bypass': secret } : {}
}
