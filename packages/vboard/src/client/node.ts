import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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

export type DetectedAgent = { profile: string; session: string | null }

/** Claude Code, Codex, and Grok sessions select their own profile, like Just Chat's CLI. */
export function detectAgent(env: NodeJS.ProcessEnv = process.env): DetectedAgent | null {
  const found: DetectedAgent[] = []
  if (env.CLAUDECODE === '1' || env.CLAUDE_CODE_SESSION_ID)
    found.push({ profile: 'claude', session: env.CLAUDE_CODE_SESSION_ID || null })
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID)
    found.push({ profile: 'codex', session: env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || null })
  if (env.GROK_SESSION_ID) found.push({ profile: 'grok', session: env.GROK_SESSION_ID })
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
 * A client with Node defaults: the URL from `VBOARD_URL` (or the saved
 * board), and a token from `VBOARD_TOKEN`, GitHub Actions, the Vercel
 * runtime, or your Vercel CLI login, in that order.
 */
export function createClient(options: NodeClientOptions = {}): BoardClient {
  const url = (options.url ?? process.env.VBOARD_URL ?? savedUrl())?.replace(/\/+$/, '')
  if (!url)
    throw new BoardError('no_board', 'no board URL: set VBOARD_URL or run `vboard use <url>`', 0)
  const doFetch = options.fetch ?? globalThis.fetch

  let discovery: Promise<Discovery> | undefined
  const discover = () =>
    (discovery ??= doFetch(url).then(async (response) => {
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
      ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
        : {}),
      ...(options.headers ? await (typeof options.headers === 'function' ? options.headers() : options.headers) : {}),
    }),
    fetch: doFetch,
  })
}

export { BoardError, type BoardClient, type ClientOptions, type ProfileOption } from './client.ts'
