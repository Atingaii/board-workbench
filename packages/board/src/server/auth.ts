import type { JWTVerifyGetKey } from 'jose'
import { compileAccess, FULL_ACCESS, parseScope, union, type Access, type Can } from './access.ts'
import { badRequest, forbidden, HttpError, unauthorized } from './errors.ts'

/**
 * What a request says about who's calling, beside its credential: labels the caller picks for
 * itself, under whoever the credential turns out to be. They're never security: board() uses them
 * to work out the actor a verified caller writes as.
 */
export type Claims = {
  /** `x-board-profile`: the agent or tool it writes as, `claude`, say. */
  profile: string | null
  /** `x-board-avatar`: an https URL for its picture. */
  avatar: string | null
  /** `x-board-session`: the agent session it writes from. */
  session: string | null
  /** `x-board-handle` and `x-board-name`: a person's handle and display name. */
  handle: string | null
  name: string | null
  /** `x-board-scope`: what it narrows itself to, `dev/=read,post`. It only narrows. */
  scope: string | null
}

/** A request, as board() hands it to `authenticate`: what it said, none of it verified yet. */
export type CallerRequest = {
  /** The bearer token, or null when it sent none. */
  credential: string | null
  claims: Claims
  /** The board's URL, which a token must be minted for. */
  audience: string
  /** Its headers, for a verifier that recognizes a session of its own: a same-site page's cookie, say. */
  headers: Headers
}

/** `external`: a platform user writing through sync (`slack:user:U0456`). A local board's people are `local:user:<name>`. */
export type PrincipalKind = 'person' | 'deployment' | 'workflow' | 'external'

/**
 * Who's calling, as board() verified it: an ID in the board's scheme and what its token said.
 * What it may do is board()'s `access` to say.
 */
export type Principal = {
  /** `vercel:user:<id>`, `vercel:project:<id>:<env>`, `github:repo:<id>`, `oidc:<issuer>:<sub>`. */
  id: string
  kind: PrincipalKind
  /** The default handle; a person's is replaced by the handle their CLI sends, unless a host's verifier named them. */
  handle: string
  expiresAt: Date | null
  /** The verified token's claims, so its access can be worked out again later, as a schedule's sends do. Absent for people and the board's own code. */
  facts?: TokenFacts
  /** The `x-board-scope` a proxy sent, which narrows whatever it may do. */
  scope?: string
  /**
   * The board token it came with (its ID), kept with what it stores: a schedule or a registration
   * made with one stops when the token does.
   */
  token?: string
  /** What a board token pins for every request with it: the profile, avatar, and session it writes as, and a person's handle and name. */
  pinned?: Pinned
}

/** What a board token says about who writes, beside its principal: labels, but the board's, so a request can't change them. */
export type Pinned = {
  profile: string | null
  avatar: string | null
  session: string | null
  /** A person's handle and display name as they were when they minted it: whoever holds the token sends none. */
  handle: string | null
  name: string | null
}

/** A principal and what it may do in each channel, as board()'s `access` worked it out. */
export type Granted = Principal & { access: Access }

/**
 * Whether a caller wrote what `by` says, as far as changing it goes (editing, deleting, canceling a
 * schedule): its principal did, and when a board token pins the profile it writes as, as that
 * profile. A token acts as its minter, so the principal alone would let one agent's token change
 * what its minter or another agent wrote. Another token that pins the same profile writes as the
 * same author, so a renewed one picks up where the last left off.
 */
export const wroteAs = (caller: { principal: Pick<Principal, 'id' | 'pinned'>; actor: { id: string } }, by: { principal: string; actor: string }) =>
  by.principal === caller.principal.id && ((caller.principal.pinned?.profile ?? null) === null || by.actor === caller.actor.id)

/**
 * Principal IDs a board authenticates: its people, deployments, workflows, and its own code. No
 * platform actor sync writes as may have one, or an import could pass for someone signed in.
 */
export const authenticates = (id: string) => /^(vercel|oidc|local|board):/.test(id) || id.startsWith('github:repo:')

/** What a verified token said: its issuer and its claims, never the token itself. */
export type TokenFacts = {
  /** `host`: a host's own verifier recognized the caller; its claims are when that runs out. */
  issuer: 'vercel' | 'github' | 'oidc' | 'host'
  iss: string
  claims: Readonly<Record<string, string | number | boolean>>
}

export type IssuerConfig = {
  /** Accepted `iss` values. */
  issuer: string | RegExp
  /** Key source; defaults to the issuer's published JWKS. */
  jwks?: JWTVerifyGetKey
}

/** `oidcTokens()`'s options: tests point these at a local issuer; production uses the defaults. */
export type OidcTokensOptions = {
  vercel?: IssuerConfig
  github?: IssuerConfig
  /** Keys for the OIDC issuers grants name, by issuer URL, instead of their published JWKS. It trusts no issuer by itself. */
  oidc?: Readonly<Record<string, JWTVerifyGetKey>>
  /**
   * A local board's own issuer (`vb serve`): its tokens' `sub` is a person on
   * this machine, `local:user:<sub>`, with full access. Its keys are never
   * fetched, so `jwks` is required.
   */
  local?: { issuer: string; jwks: JWTVerifyGetKey }
}

export const VERCEL_ISSUER = /^https:\/\/oidc\.vercel\.com(?:\/[a-z0-9-]+)?$/
export const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com'

/**
 * `gitlab.com`, `example.com/oidc`, `ci.test%3A8443`: an issuer as a principal
 * names it. A `:` (a port) and a `%` are percent-encoded, so the name has no `:`
 * and the `sub` after it can hold anything. Issuers that differ only in what the
 * URL normalizes (a trailing slash, the host's case) share a name, so the board
 * refuses to trust two of them.
 */
export const issuerName = (iss: string) => {
  const url = new URL(iss)
  return `${url.host}${url.pathname.replace(/\/+$/, '')}`.replace(/[%:]/g, (char) => (char === '%' ? '%25' : '%3A'))
}

/** OIDC issuers to trust, checked: two that name the same principals can't both be. */
export function trustedIssuers(issuers: readonly string[]): Set<string> {
  const named = new Map<string, string>()
  for (const iss of issuers) {
    const name = issuerName(iss)
    const other = named.get(name)
    if (other !== undefined && other !== iss)
      throw new Error(`oidc issuers ${other} and ${iss} name the same principals, oidc:${name}:<sub>: pin one of them`)
    named.set(name, iss)
  }
  return new Set(issuers)
}

/** A principal as the board keeps it to work its access out again: who it is, its token's facts, its scope, and the board token it came with. */
export type Known = Pick<Principal, 'id' | 'kind' | 'handle' | 'facts' | 'scope' | 'token'>

/**
 * A grant as it's asked for: an issuer, the claims its tokens must carry, and what they may do.
 * `vercel` and `github` name their issuers; any other is an https URL. Every claim must match
 * exactly, and a list is any of its values.
 */
export type GrantSpec = {
  issuer: string
  claims: Readonly<Record<string, string | readonly string[]>>
  /** What it lets them do; read, post, react, and label everywhere when left out. */
  can?: Can
}

/** A grant the board keeps: its ID, its issuer and claims as the board checked them, and who set it when. */
export type StoredGrant = {
  id: string
  issuer: string
  claims: Readonly<Record<string, string | readonly string[]>>
  can: Can
  /** The actor that last set it, and when. */
  by: string
  at: string
}

/** What a board token starts with, so board() knows its own before it tries any other verifier. */
export const BOARD_TOKEN_PREFIX = 'board_'

/**
 * A board token's SHA-256, hex: what the board keeps instead of the secret, both when it mints one
 * and when a request carries one. A token is 32 random bytes, so no salt or key is needed.
 */
export async function tokenHash(secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * What a grant or a token left without `can` gives: what Vercel's API gives a project it lets use a
 * board. Frozen all the way down: board reads it for every such grant, and @vercel/board/access
 * exports it, so code that imports it can't widen them.
 */
export const DEFAULT_CAN: Can = Object.freeze({ '*': Object.freeze(['read', 'post', 'react', 'label'] as const) })
const GRANT_CLAIMS_MAX = 32
const GRANT_VALUES_MAX = 32
const GRANT_VALUE_MAX = 1000

const invalidGrant = (message: string) => badRequest(message, 'invalid_grant')

/** Whether `host` names something on the board's own network rather than on the internet. */
export function privateHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '')
  if (name.startsWith('[') || /^\d+(\.\d+){3}$/.test(name) || /^\d+$/.test(name)) return true
  if (!name.includes('.') || name === 'localhost') return true
  return /\.(localhost|local|internal|home|lan|corp|intranet)$/.test(name)
}

/**
 * A grant checked and put in one form: its issuer, its claims with keys and lists sorted, its
 * `can`, and the key that says it's the same grant as another. A 400 `invalid_grant` that says
 * what to write. `trusted`: the issuers other grants name, which no two may share principals
 * between.
 */
export function checkGrant(spec: GrantSpec, trusted: readonly string[]): { issuer: string; claims: Record<string, string | string[]>; can: Can; key: string } {
  const { issuer } = spec
  if (typeof issuer !== 'string' || issuer === '') throw invalidGrant('a grant needs an issuer: vercel, github, or an https URL')
  if (issuer !== 'vercel' && issuer !== 'github') {
    let url: URL
    try {
      url = new URL(issuer)
    } catch {
      throw invalidGrant(`a grant's issuer is vercel, github, or an https URL, got ${issuer}`)
    }
    if (VERCEL_ISSUER.test(issuer)) throw invalidGrant("write the issuer as vercel, and another team's projects with owner_id")
    if (issuer === GITHUB_ISSUER) throw invalidGrant('write the issuer as github')
    if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password)
      throw invalidGrant(`a grant's issuer is an https URL with no query or credentials, got ${issuer}`)
    if (privateHost(url.hostname)) throw invalidGrant(`a grant's issuer is on the internet, not ${url.hostname}`)
    const name = issuerName(issuer)
    const other = trusted.find((candidate) => candidate !== issuer && /^https:/.test(candidate) && issuerName(candidate) === name)
    if (other !== undefined) throw invalidGrant(`issuers ${other} and ${issuer} name the same principals, oidc:${name}:<sub>: use ${other}`)
  }
  const entries = typeof spec.claims === 'object' && spec.claims !== null ? Object.entries(spec.claims) : []
  if (entries.length === 0) throw invalidGrant(`name at least one claim for ${issuer}: its issuer signs tokens for everyone it serves`)
  if (entries.length > GRANT_CLAIMS_MAX) throw invalidGrant(`a grant names at most ${GRANT_CLAIMS_MAX} claims`)
  const claims: Record<string, string | string[]> = {}
  for (const [name, value] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    const values = typeof value === 'string' ? [value] : Array.isArray(value) ? [...new Set(value as readonly unknown[])] : []
    if (values.length === 0 || values.some((one) => typeof one !== 'string' || one === ''))
      throw invalidGrant(`claim ${name} has no value to match: give a string, or a list of them`)
    if (values.length > GRANT_VALUES_MAX || values.some((one) => (one as string).length > GRANT_VALUE_MAX))
      throw invalidGrant(`claim ${name} lists at most ${GRANT_VALUES_MAX} values of up to ${GRANT_VALUE_MAX} characters`)
    const sorted = (values as string[]).sort()
    claims[name] = sorted.length === 1 ? sorted[0]! : sorted
  }
  if (issuer === 'vercel' && (claims.project_id === undefined || claims.environment === undefined))
    throw invalidGrant('a Vercel grant names project_id and environment: a preview runs any branch, so it says outright whether they get in')
  if (issuer === 'github' && claims.repository === undefined && claims.repository_id === undefined)
    throw invalidGrant('a GitHub grant names repository or repository_id: GitHub signs tokens for every repository')
  const can = spec.can ?? DEFAULT_CAN
  try {
    compileAccess(can)
  } catch (error) {
    throw invalidGrant((error as Error).message)
  }
  return { issuer, claims, can, key: JSON.stringify([issuer, claims]) }
}

/** Whether a verified token's facts are a grant's: its issuer, and every claim it names. */
export function grantMatches(grant: Pick<StoredGrant, 'issuer' | 'claims'>, facts: TokenFacts): boolean {
  const issuer = grant.issuer === 'vercel' || grant.issuer === 'github' ? facts.issuer === grant.issuer : facts.issuer === 'oidc' && facts.iss === grant.issuer
  if (!issuer) return false
  return Object.entries(grant.claims).every(([name, allowed]) => {
    const value = facts.claims[name]
    if (value === undefined) return false
    const text = String(value)
    return typeof allowed === 'string' ? text === allowed : allowed.includes(text)
  })
}

/** The OIDC issuers grants name past Vercel and GitHub: their tokens are verified too. */
export const grantIssuers = (grants: readonly Pick<StoredGrant, 'issuer'>[]) =>
  [...new Set(grants.flatMap((grant) => (grant.issuer === 'vercel' || grant.issuer === 'github' ? [] : [grant.issuer])))]

/** A token no grant lets in, and the grant that would. */
const notGranted = (who: string, grant: string) =>
  new HttpError(403, 'forbidden', `this token can't use this board: no grant lets in ${who}`, { hint: `Grant it: vb grants create ${grant}` })

/**
 * What principals may do: people, and the board's own deployments in its environment, everything;
 * anyone else what the board's grants that match its token give, all of them adding up. A board
 * token's principal is the one that minted it, narrowed.
 */
export function createAuthority(options: {
  /** Whether a host's verifier makes this board's principals: false for one whose verifier is the built-in one alone. */
  hosts: boolean
  /** The board's own Vercel project and team. */
  project: () => Promise<{ id: string | null; teamId: string | null }>
  /** The grants the board keeps, as they are now. Null where it keeps none. */
  grants?: (() => Promise<readonly StoredGrant[]>) | null
}) {
  /**
   * What a principal that isn't a person may do: everything for the board's own deployments in its
   * environment, and for anyone else, every grant that matches its token, added up. A 401 or 403
   * that says which grant would let it in, when none does.
   */
  async function byGrants(facts: TokenFacts | null): Promise<Access> {
    const claims = facts?.claims ?? {}
    const own = facts?.issuer === 'vercel' ? await options.project() : null
    const environment = String(claims.environment ?? '')
    // A deployment in the board's own environment runs the board's code. A
    // preview runs any branch's, so a production board doesn't trust them.
    const here = boardEnvironment()
    const ownDeployment = own !== null && own.id !== null && claims.project_id === own.id
    if (ownDeployment && here !== null && environment === here) return FULL_ACCESS
    if (!facts) throw forbidden("this token can't use this board")
    const grants = options.grants ? await options.grants() : []
    const granted = grants.filter((grant) => grantMatches(grant, facts)).map((grant) => compileAccess(grant.can))
    if (granted.length > 0) return union(granted)
    // An issuer a grant names is trusted: its token just isn't one the grant lets in.
    if (facts.issuer === 'oidc' && !grants.some((grant) => grant.issuer === facts.iss)) throw unauthorized(`untrusted issuer: ${facts.iss}`)
    if (facts.issuer === 'oidc') throw forbidden("this token can't use this board: no grant lets in its claims")
    if (facts.issuer === 'github') {
      const repository = String(claims.repository ?? '')
      throw notGranted(repository || 'its repository', `github --claim repository=${repository || '<OWNER/REPO>'}`)
    }
    const project = String(claims.project_id ?? '') || '<PROJECT_ID>'
    const grant = `vercel --claim project_id=${project} --claim environment=${environment || '<ENVIRONMENT>'}`
    if (ownDeployment)
      throw new HttpError(403, 'forbidden', `this token can't use this board: it runs in ${here ?? 'no Vercel environment'}, and its ${environment || 'unnamed'} deployments need a grant`, {
        hint: `Grant them: vb grants create ${grant}`,
      })
    throw notGranted(`project ${project} in ${environment || 'no environment'}`, grant)
  }

  /**
   * What a principal may do now, narrowed by its scope: the board's own code and the platform users
   * sync writes as everything; a person everything; anyone else what the board's grants give. A
   * host's principal is what its kind is, until it expires. A 401 or 403 when it may do nothing.
   */
  async function grant(principal: Known): Promise<Access> {
    let access: Access = FULL_ACCESS
    const hosted = principal.facts?.issuer === 'host'
    // A platform user sync writes as is `external` too, but one a host's verifier returns is a host's principal.
    if (principal.id.startsWith('board:') || (principal.kind === 'external' && !hosted)) access = FULL_ACCESS
    else {
      if (hosted) {
        // One a host's verifier made, on a board whose verifier is now the built-in one alone, is from before it switched.
        if (!options.hosts) throw forbidden("this token can't use this board: its board no longer takes a host's principals")
        const { exp } = principal.facts!.claims
        if (typeof exp === 'number' && exp * 1000 <= Date.now()) throw unauthorized('token expired')
      }
      // A host's says nothing past its ID, as a principal stored before the board kept claims.
      if (principal.kind !== 'person') access = await byGrants((hosted ? undefined : principal.facts) ?? factsFromId(principal.id))
    }
    return principal.scope === undefined ? access : access.narrow(parseScope(principal.scope))
  }

  /** What a stored principal (a schedule's creator, a watcher's registrant) may do now: null once nothing. */
  async function accessNow(principal: Known): Promise<Access | null> {
    try {
      return await grant(principal)
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status === 401 || status === 403) return null
      throw error
    }
  }

  return { grant, accessNow }
}

/**
 * The Vercel environment the board runs in: `production`, `preview`, or a
 * custom environment's name. `VERCEL_TARGET_ENV` names custom environments,
 * where `VERCEL_ENV` says `preview`. Null outside Vercel, where only people
 * get in without a grant.
 */
const boardEnvironment = (): string | null => process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV || null

/**
 * What a principal's ID still says, for one stored before the board kept
 * claims: a deployment's project ID and environment. A workflow's ID names
 * neither its repository nor its run, so it says nothing, and a grant that
 * needs more than the ID no longer matches.
 */
function factsFromId(id: string): TokenFacts | null {
  const deployment = id.match(/^vercel:project:([^:]+):([^:]+)$/)
  return deployment ? { issuer: 'vercel', iss: '', claims: { project_id: deployment[1]!, environment: deployment[2]! } } : null
}

/** What board() knows that verifying a request needs: its own Vercel project, and the OIDC issuers its grants trust. */
export type AuthenticateContext = {
  /** The board's own Vercel project and team: its people's development tokens are for it. */
  project(): Promise<{ id: string | null; teamId: string | null }>
  /** OIDC issuers past Vercel's and GitHub's whose tokens may be trusted: the ones grants name. */
  issuers: readonly string[]
}

/** What a verifier gets: what the request said, and what the board knows that verifying it needs. */
export type AuthenticateRequest = CallerRequest & { board: AuthenticateContext }

/**
 * Who a request is, in the board's ID scheme: `oidcTokens()` checks its bearer token for the
 * board's URL, and a host's own verifier recognizes its own credentials (a session cookie in
 * `request.headers`, say). Null when the request carries nothing it recognizes, so verifiers
 * compose: `(request) => (await staff(request)) ?? (await tokens(request))`. To reject a
 * credential that fails, throw an `HttpError` (a 401), or return or throw a `Response`; anything
 * else thrown is a 500. What a principal may do is the board's defaults' and grants' to say.
 */
export type Authenticate = (
  request: AuthenticateRequest,
) => Principal | HostPrincipal | Response | null | undefined | Promise<Principal | HostPrincipal | Response | null | undefined>

/** What a host's own verifier returns: a principal in the board's ID scheme. */
export type HostPrincipal = {
  /** `vercel:user:<id>`, `vercel:project:<id>:<env>`, …: records keep their shape. */
  id: string
  kind: PrincipalKind
  /** Kept as it is: `x-board-handle` doesn't replace it. Return `request.claims.handle` to take the caller's. */
  handle: string
  expiresAt?: Date | null
}

/** What marks `oidcTokens()`, so board() can tell it makes no host's principals. */
export const TOKENS = Symbol('board.oidcTokens')
/** The principals `oidcTokens()` made: board() takes them as they are, and checks the rest as a host's. */
const verifiedTokens = new WeakSet<object>()

/** Marks a principal `oidcTokens()` made. */
export function markVerified(principal: Principal): Principal {
  verifiedTokens.add(principal)
  return principal
}

/** Whether `authenticate` is `oidcTokens()`'s alone: it makes no host's principals. */
export const verifiesTokens = (authenticate: Authenticate) => TOKENS in authenticate

/** Whether `oidcTokens()` made `principal`, as opposed to a host's own verifier. */
export const fromTokens = (principal: object) => verifiedTokens.has(principal)

const PRINCIPAL_ID = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*:[^\s+\]]{1,200}$/
const KINDS: readonly PrincipalKind[] = ['person', 'deployment', 'workflow', 'external']

/**
 * Checks what a host's own verifier returned. A malformed principal is the host's bug, so it
 * fails the request rather than letting a half-identity write.
 */
export function hostPrincipal(value: HostPrincipal): Principal {
  const fail = (why: string): never => {
    throw new TypeError(`authenticate returned an invalid principal: ${why}`)
  }
  if (typeof value !== 'object' || value === null) fail('not an object')
  if (typeof value.id !== 'string' || !PRINCIPAL_ID.test(value.id) || value.id.startsWith('board:'))
    fail(`id must look like \`vercel:user:<id>\`, got ${JSON.stringify(value.id)}`)
  if (!KINDS.includes(value.kind)) fail(`kind must be one of ${KINDS.join(', ')}`)
  if (typeof value.handle !== 'string' || !/^\S{1,64}$/.test(value.handle)) fail('handle must be 1-64 characters, no spaces')
  const expiresAt = value.expiresAt ?? null
  if (expiresAt !== null && (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime()))) fail('expiresAt must be a Date or null')
  if (expiresAt !== null && expiresAt.getTime() <= Date.now()) throw unauthorized('token expired')
  const claims: Record<string, number> = expiresAt === null ? {} : { exp: Math.floor(expiresAt.getTime() / 1000) }
  return { id: value.id, kind: value.kind, handle: value.handle, expiresAt, facts: { issuer: 'host', iss: '', claims } }
}
