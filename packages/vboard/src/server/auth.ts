import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose'
import { compileAccess, FULL_ACCESS, parseScope, type Access, type Can, type Permission } from './access.ts'
import type { CallerRequest } from './backend.ts'
import { unauthorized, forbidden } from './errors.ts'

/** `external`: a platform user writing through sync (`slack:user:U0456`). A local board's people are `local:user:<name>`. */
export type PrincipalKind = 'person' | 'deployment' | 'workflow' | 'external'

/**
 * Who's calling, as a backend verified it: an ID in the board's scheme and what its token said.
 * What it may do is the backend's to work out: a2() from its `access`.
 */
export type Principal = {
  /** `vercel:user:<id>`, `vercel:project:<id>:<env>`, `github:repo:<id>`, `oidc:<issuer>:<sub>`. */
  id: string
  kind: PrincipalKind
  /** The default handle; a person's is replaced by the handle their CLI sends. */
  handle: string
  expiresAt: Date | null
  /** The verified token's claims, so its access can be worked out again later, as a schedule's sends do. Absent for people and the board's own code. */
  facts?: TokenFacts
  /** The `x-board-scope` a proxy sent, which narrows whatever it may do. */
  scope?: string
}

/** A principal and what it may do in each channel, as a backend worked it out. */
export type Granted = Principal & { access: Access }

/**
 * Principal IDs a board authenticates: its people, deployments, workflows, and its own code. No
 * platform actor sync writes as may have one, or an import could pass for someone signed in.
 */
export const authenticates = (id: string) => /^(vercel|oidc|local|vboard):/.test(id) || id.startsWith('github:repo:')

type Claims = JWTPayload & Record<string, unknown>

/** What a verified token said: its issuer and its claims, never the token itself. */
export type TokenFacts = {
  /** `host`: a host's own verifier recognized the caller; its claims are when that runs out. */
  issuer: 'vercel' | 'github' | 'oidc' | 'host'
  iss: string
  claims: Readonly<Record<string, string | number | boolean>>
  /**
   * The board's own Vercel team, as the board knew it when it verified the
   * token. A schedule's send may run where the board can't work it out (the
   * scheduler's own function, with no request to learn it from), and a rule
   * naming a project without its team needs it. Only the board writes it.
   */
  team?: string
}

const REGISTERED = new Set(['aud', 'exp', 'iat', 'nbf', 'jti'])

/** The claims rules can match on: plain values, bounded, as a schedule stores them. */
function factsOf(issuer: TokenFacts['issuer'], iss: string, claims: Claims): TokenFacts {
  const kept: Record<string, string | number | boolean> = {}
  for (const [name, value] of Object.entries(claims)) {
    if (REGISTERED.has(name) || Object.keys(kept).length >= 64) continue
    if (typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 1000)) kept[name] = value
  }
  return { issuer, iss, claims: kept }
}

/** What a rule may compare claims to: the board's own Vercel team and project, when they're known. */
export type MatchContext = { teamId: string | null; projectId: string | null }

/** One entry in `a2({ access })`: who it matches, and what they may do. The first entry that matches decides. */
export type AccessRule = {
  /** `vercel` and `github` are their platforms' issuers; `oidc` is the exact `url`. */
  issuer: 'vercel' | 'github' | 'oidc'
  /** For `oidc`: the issuer URL, pinned in code. */
  url?: string
  matches(claims: Claims, context: MatchContext): boolean
  access: Access
}

/** A token no rule matches, and the rule that would let it in. */
const notInAccess = (rule: string) => forbidden(`this token can't use this board: add ${rule} to access`)

/** A rule's `can`, compiled. A rule without one says which rule and what to write. */
function accessOf(rule: string, can: Can | undefined): Access {
  if (can === undefined || can === null)
    throw new Error(`${rule} needs can: say what it may do, like can: { 'ci/': ['read', 'post'] }, or can: 'all'`)
  return compileAccess(can)
}

const oneOf = (value: unknown, allowed: string | readonly string[] | undefined) =>
  allowed === undefined ||
  (typeof value === 'string' && (typeof allowed === 'string' ? [allowed] : allowed).includes(value))

/**
 * A Vercel project's deployments, by name or ID. A name is only unique within
 * a team, so without `team` it means the board's own team, and matches nothing
 * when that isn't known. An ID is unique on Vercel, so it matches on any team.
 * `'self'` is the board's own project: its deployments in the environment the
 * board runs in have full access unless a rule says otherwise, and its other
 * environments have none unless one lists them. Its development tokens are
 * people, which no rule changes.
 */
export function vercelProject(options: {
  project: string
  team?: string
  environments?: readonly string[]
  can: Can
}): AccessRule {
  if (options.project === 'self' && options.team !== undefined)
    throw new Error("vercelProject({ project: 'self' }) is the board's own project: drop team")
  return {
    issuer: 'vercel',
    access: accessOf(`vercelProject({ project: '${options.project}' })`, options.can),
    matches: (claims, { teamId, projectId }) =>
      (options.project === 'self'
        ? projectId !== null && claims.project_id === projectId
        : claims.project_id === options.project ||
          (claims.project === options.project &&
            (options.team === undefined
              ? teamId !== null && claims.owner_id === teamId
              : claims.owner === options.team || claims.owner_id === options.team))) &&
      oneOf(claims.environment, options.environments),
  }
}

/**
 * A GitHub Actions workflow. A `pull_request` run's token carries
 * `ref: refs/pull/<n>/merge`, so match those on `event` and `workflow`, not `ref`.
 */
export function githubActions(options: {
  repository: string
  event?: string | readonly string[]
  workflow?: string
  ref?: string
  can: Can
}): AccessRule {
  return {
    issuer: 'github',
    access: accessOf(`githubActions({ repository: '${options.repository}' })`, options.can),
    matches: (claims) =>
      claims.repository === options.repository &&
      oneOf(claims.event_name, options.event) &&
      (options.ref === undefined || claims.ref === options.ref) &&
      (options.workflow === undefined ||
        (typeof claims.workflow_ref === 'string' &&
          claims.workflow_ref.startsWith(`${options.repository}/${options.workflow}@`))),
  }
}

/**
 * Any OIDC issuer's tokens: GitLab, Buildkite, a cloud's workload identity.
 * The issuer is pinned here, and only issuers some rule names are trusted or
 * have their keys fetched. Every listed claim must match exactly (a list is
 * any of its values), and there must be at least one, since an issuer signs
 * tokens for everyone it serves. The principal is `oidc:<issuer host and path>:<sub>`,
 * with any `:` or `%` in the issuer part percent-encoded, so it ends at the first `:`.
 */
export function oidc(options: {
  issuer: string
  claims: Readonly<Record<string, string | readonly string[]>>
  can: Can
}): AccessRule {
  let url: URL
  try {
    url = new URL(options.issuer)
  } catch {
    throw new Error(`oidc: issuer must be a URL, got ${options.issuer}`)
  }
  if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password)
    throw new Error(`oidc: issuer must be an https URL with no query or credentials, got ${options.issuer}`)
  if (VERCEL_ISSUER.test(options.issuer)) throw new Error('oidc: use vercelProject() for Vercel tokens')
  if (options.issuer === GITHUB_ISSUER) throw new Error('oidc: use githubActions() for GitHub Actions tokens')
  const required = Object.entries(options.claims)
  if (required.length === 0) throw new Error(`oidc: name at least one claim to match for ${options.issuer}`)
  // An unset value (an environment variable that isn't there) must not match every token the issuer signs.
  for (const [name, allowed] of required) {
    const values: readonly unknown[] = typeof allowed === 'string' ? [allowed] : Array.isArray(allowed) ? allowed : []
    if (values.length === 0 || values.some((value) => typeof value !== 'string' || value === ''))
      throw new Error(`oidc: claim ${name} has no value to match for ${options.issuer}`)
  }
  return {
    issuer: 'oidc',
    url: options.issuer,
    access: accessOf(`oidc({ issuer: '${options.issuer}' })`, options.can),
    matches: (claims) => required.every(([name, allowed]) => oneOf(claims[name], allowed)),
  }
}

export type IssuerConfig = {
  /** Accepted `iss` values. */
  issuer: string | RegExp
  /** Key source; defaults to the issuer's published JWKS. */
  jwks?: JWTVerifyGetKey
}

/** `verifyTokens()`'s options: tests point these at a local issuer; production uses the defaults. */
export type VerifyTokensOptions = {
  vercel?: IssuerConfig
  github?: IssuerConfig
  /** Keys for `oidc()` issuers, by issuer URL, instead of their published JWKS. It trusts no issuer by itself. */
  oidc?: Readonly<Record<string, JWTVerifyGetKey>>
  /**
   * A local board's own issuer (`vb serve`): its tokens' `sub` is a person on
   * this machine, `local:user:<sub>`, with full access. Its keys are never
   * fetched, so `jwks` is required.
   */
  local?: { issuer: string; jwks: JWTVerifyGetKey }
}

const VERCEL_ISSUER = /^https:\/\/oidc\.vercel\.com(?:\/[a-z0-9-]+)?$/
const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com'

const issuerMatches = (iss: string, accepted: string | RegExp) =>
  typeof accepted === 'string' ? iss === accepted : accepted.test(iss)

const remoteKeys = new Map<string, JWTVerifyGetKey>()

async function keysFor(iss: string): Promise<JWTVerifyGetKey> {
  const cached = remoteKeys.get(iss)
  if (cached) return cached
  const response = await fetch(`${iss.replace(/\/+$/, '')}/.well-known/openid-configuration`)
  if (!response.ok) throw unauthorized(`cannot load keys for issuer ${iss}`)
  const { jwks_uri } = (await response.json()) as { jwks_uri: string }
  const keys = createRemoteJWKSet(new URL(jwks_uri))
  remoteKeys.set(iss, keys)
  return keys
}

/**
 * `gitlab.com`, `example.com/oidc`, `ci.test%3A8443`: an issuer as a principal
 * names it. A `:` (a port) and a `%` are percent-encoded, so the name has no `:`
 * and the `sub` after it can hold anything. Issuers that differ only in what the
 * URL normalizes (a trailing slash, the host's case) share a name, so the board
 * refuses to trust two of them.
 */
const issuerName = (iss: string) => {
  const url = new URL(iss)
  return `${url.host}${url.pathname.replace(/\/+$/, '')}`.replace(/[%:]/g, (char) => (char === '%' ? '%25' : '%3A'))
}

/** What tokens are verified with: the platform's issuers, OIDC issuers a backend's rules name, and test issuers. */
function createVerifier(options: {
  projectId: () => Promise<string | null>
  /** The board's team from config or the environment; the platform's token is the fallback. */
  teamId: () => Promise<string | null>
  /** OIDC issuers past Vercel's and GitHub's whose tokens are verified: the ones the backend's rules name. */
  issuers: readonly string[]
  auth?: VerifyTokensOptions | undefined
}) {
  const vercelIssuer = options.auth?.vercel ?? { issuer: VERCEL_ISSUER }
  const githubIssuer = options.auth?.github ?? { issuer: GITHUB_ISSUER }
  // The only issuers past Vercel's and GitHub's whose tokens are verified, or whose keys are fetched.
  const oidcIssuers = trustedIssuers(options.issuers)

  let platformTeam: string | null = null
  /**
   * The team on a Vercel-signed token for the board's own project. Project IDs
   * are unique, so its `owner_id` is the board's team, whoever sent the token.
   */
  async function teamFrom(platformToken: string | undefined, ownProject: string | null) {
    if (platformTeam !== null || !platformToken || ownProject === null) return platformTeam
    try {
      const iss = String(decodeJwt(platformToken).iss ?? '')
      if (!issuerMatches(iss, vercelIssuer.issuer)) return null
      const keys = vercelIssuer.jwks ?? (await keysFor(iss))
      const { payload } = await jwtVerify(platformToken, keys, { issuer: iss })
      if (payload.project_id === ownProject && typeof payload.owner_id === 'string') platformTeam = payload.owner_id
    } catch {}
    return platformTeam
  }

  /** `platformToken`: the board's own OIDC token, which Vercel sends with each request. */
  async function verify(token: string, audience: string, platformToken?: string): Promise<Principal> {
    let iss: string
    try {
      iss = String(decodeJwt(token).iss ?? '')
    } catch {
      throw unauthorized('malformed token')
    }

    const local = options.auth?.local
    if (local && iss === local.issuer) return localPerson(token, local, audience)

    const isVercel = issuerMatches(iss, vercelIssuer.issuer)
    const isGitHub = !isVercel && issuerMatches(iss, githubIssuer.issuer)
    const isOidc = !isVercel && !isGitHub && oidcIssuers.has(iss)
    if (!isVercel && !isGitHub && !isOidc) throw unauthorized(`untrusted issuer: ${iss || '(none)'}`)

    let claims: Claims
    try {
      const keys = isOidc
        ? (options.auth?.oidc?.[iss] ?? (await keysFor(iss)))
        : ((isVercel ? vercelIssuer : githubIssuer).jwks ?? (await keysFor(iss)))
      ;({ payload: claims } = (await jwtVerify(token, keys, { issuer: iss, audience })) as {
        payload: Claims
      })
    } catch (error) {
      if ((error as { status?: number }).status === 401) throw error
      throw unauthorized(`invalid token: ${(error as Error).message}`)
    }
    const facts = factsOf(isOidc ? 'oidc' : isGitHub ? 'github' : 'vercel', iss, claims)
    const expiresAt = claims.exp ? new Date(claims.exp * 1000) : null

    if (isOidc) {
      if (typeof claims.sub !== 'string' || claims.sub === '') throw unauthorized(`token from ${iss} without sub`)
      return { id: `oidc:${issuerName(iss)}:${claims.sub}`, kind: 'workflow', handle: claims.sub.slice(0, 128), expiresAt, facts }
    }
    if (isGitHub)
      return { id: `github:repo:${String(claims.repository_id)}`, kind: 'workflow', handle: String(claims.repository), expiresAt, facts }

    const environment = String(claims.environment ?? '')
    const project = String(claims.project ?? '')
    const ownProject = (await options.projectId()) ?? null
    if (ownProject !== null && claims.project_id === ownProject && environment === 'development') {
      // A development token minted with someone's Vercel login carries their user ID.
      if (typeof claims.user_id !== 'string') throw unauthorized('development token without user_id')
      return { id: `vercel:user:${claims.user_id}`, kind: 'person', handle: `user-${claims.user_id.slice(0, 6).toLowerCase()}`, expiresAt }
    }
    const teamId = (await options.teamId()) ?? (await teamFrom(platformToken ?? process.env.VERCEL_OIDC_TOKEN, ownProject)) ?? null
    // Kept with the claims, so a rule naming a project without its team matches later as it does now.
    return deployment(teamId === null ? facts : { ...facts, team: teamId }, project, environment, expiresAt)
  }

  return { verify }
}

/** OIDC issuers to trust, checked: two that name the same principals can't both be. */
function trustedIssuers(issuers: readonly string[]): Set<string> {
  const named = new Map<string, string>()
  for (const iss of issuers) {
    const name = issuerName(iss)
    const other = named.get(name)
    if (other !== undefined && other !== iss)
      throw new Error(`access: oidc issuers ${other} and ${iss} name the same principals, oidc:${name}:<sub>: pin one of them`)
    named.set(name, iss)
  }
  return new Set(issuers)
}

/** The OIDC issuers rules name: the only ones whose tokens are verified for them. */
export const issuersOf = (rules: readonly AccessRule[]) => [...new Set(rules.flatMap((rule) => (rule.issuer === 'oidc' ? [rule.url!] : [])))]

/**
 * What a host's own model gives a principal: what it may do, or null for nothing. It sees only the
 * principals its own `authenticate` returned.
 */
export type AccessFunction = (principal: Known) => Can | null | undefined | Promise<Can | null | undefined>

/** A principal as a backend keeps it to work its access out again: who it is, its token's facts, and its scope. */
export type Known = Pick<Principal, 'id' | 'kind' | 'handle' | 'facts' | 'scope'>

/**
 * What principals may do, under a backend's rules: `vercelProject()`, `githubActions()`, `oidc()`,
 * the first that matches deciding, past the defaults (people, and the board's own deployments in
 * its environment, may do everything). Or a host's own function of the principal.
 */
export function createAuthority(options: {
  access: readonly AccessRule[] | AccessFunction
  /** The board's own Vercel project and team. */
  project: () => Promise<{ id: string | null; teamId: string | null }>
}) {
  const rules = typeof options.access === 'function' ? null : options.access
  const host = typeof options.access === 'function' ? options.access : null
  const oidcIssuers = trustedIssuers(rules ? issuersOf(rules) : [])
  const ruleFor = (issuer: AccessRule['issuer'], claims: Claims, context: MatchContext, url?: string): Access | null =>
    rules?.find((rule) => rule.issuer === issuer && (url === undefined || rule.url === url) && rule.matches(claims, context))?.access ?? null

  /** What the rules give these facts: a 401 or 403 that says which rule would let them in, when none does. */
  async function byRules(facts: TokenFacts): Promise<Access> {
    const { issuer, iss } = facts
    const claims = facts.claims as Claims
    if (issuer === 'host') throw forbidden("this token can't use this board: its board no longer takes a host's principals")
    if (issuer === 'oidc') {
      if (!oidcIssuers.has(iss)) throw unauthorized(`untrusted issuer: ${iss}`)
      const access = ruleFor('oidc', claims, { teamId: null, projectId: null }, iss)
      if (!access) throw notInAccess(`oidc({ issuer: '${iss}', claims, can })`)
      return access
    }
    if (issuer === 'github') {
      const access = ruleFor('github', claims, { teamId: null, projectId: null })
      if (!access) throw notInAccess(`githubActions({ repository: '${String(claims.repository)}', can })`)
      return access
    }
    const environment = String(claims.environment ?? '')
    const project = String(claims.project ?? '')
    const own = await options.project()
    const teamId = facts.team ?? own.teamId
    const access = ruleFor('vercel', claims, { teamId, projectId: own.id })
    if (access) return access
    // A deployment in the board's own environment runs the board's code. A
    // preview runs any branch's, so a production board doesn't trust them.
    const here = boardEnvironment()
    const ownDeployment = own.id !== null && claims.project_id === own.id
    if (ownDeployment && here !== null && environment === here) return FULL_ACCESS
    if (ownDeployment)
      throw forbidden(
        `this token can't use this board: it runs in ${here ?? 'no Vercel environment'}, so its ${environment || 'unnamed'} deployments need vercelProject({ project: 'self', environments: ['${environment}'], can })`,
      )
    throw notInAccess(`vercelProject({ project: '${project || String(claims.project_id)}', can })`)
  }

  /**
   * What a principal may do now, narrowed by its scope: the board's own code, its people, and the
   * platform users sync writes as everything, past a host's function; a token whatever the first rule
   * matching its claims gives. A 401 or 403 when it may do nothing.
   */
  async function grant(principal: Known): Promise<Access> {
    let access: Access = FULL_ACCESS
    if (principal.id.startsWith('vboard:') || principal.kind === 'external') access = FULL_ACCESS
    else if (host) {
      // A host's model sees only the principals its own `authenticate` made, until they expire.
      if (principal.facts?.issuer !== 'host') throw forbidden("this token can't use this board: its board takes only its host's principals")
      const { exp } = principal.facts.claims
      if (typeof exp === 'number' && exp * 1000 <= Date.now()) throw unauthorized('token expired')
      const can = await host(principal)
      if (can === null || can === undefined) throw forbidden("this token can't use this board")
      access = compileAccess(can)
    } else if (principal.kind !== 'person') {
      const facts = principal.facts ?? factsFromId(principal.id)
      if (!facts) throw forbidden("this token can't use this board")
      access = await byRules(facts)
    } else if (principal.facts?.issuer === 'host') throw forbidden("this token can't use this board: its board no longer takes a host's principals")
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
 * What a principal may do under `rules` (`vercelProject()`, `githubActions()`, `oidc()`), the first
 * that matches its token deciding, past the defaults: people, and the board's own deployments in the
 * environment it runs in, may do everything. Its scope narrows what it gets. A 401 or 403 that names
 * the rule that would let it in, when it may do nothing.
 */
export function compileRules(
  rules: readonly AccessRule[],
  board: { project(): Promise<{ id: string | null; teamId: string | null }> },
): (principal: Known) => Promise<Access> {
  return createAuthority({ access: rules, project: () => board.project() }).grant
}

/**
 * The Vercel environment the board runs in: `production`, `preview`, or a
 * custom environment's name. `VERCEL_TARGET_ENV` names custom environments,
 * where `VERCEL_ENV` says `preview`. Null outside Vercel, where only people
 * get in without a rule.
 */
const boardEnvironment = (): string | null => process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV || null

/**
 * What a principal's ID still says, for one stored before the board kept
 * claims: a deployment's project ID and environment. A workflow's ID names
 * neither its repository nor its run, so it says nothing, and a rule that
 * needs more than the ID no longer matches.
 */
function factsFromId(id: string): TokenFacts | null {
  const deployment = id.match(/^vercel:project:([^:]+):([^:]+)$/)
  return deployment ? { issuer: 'vercel', iss: '', claims: { project_id: deployment[1]!, environment: deployment[2]! } } : null
}

const LOCAL_SUB = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/

async function localPerson(token: string, local: NonNullable<VerifyTokensOptions['local']>, audience: string): Promise<Principal> {
  let claims: Claims
  try {
    ;({ payload: claims } = (await jwtVerify(token, local.jwks, { issuer: local.issuer, audience })) as { payload: Claims })
  } catch (error) {
    throw unauthorized(`invalid token: ${(error as Error).message}`)
  }
  const sub = String(claims.sub ?? '')
  if (!LOCAL_SUB.test(sub)) throw unauthorized('local token without a valid sub')
  return { id: `local:user:${sub}`, kind: 'person', handle: sub, expiresAt: claims.exp ? new Date(claims.exp * 1000) : null }
}

const deployment = (facts: TokenFacts, project: string, environment: string, expiresAt: Date | null): Principal => ({
  id: `vercel:project:${String(facts.claims.project_id)}:${environment}`,
  kind: 'deployment',
  handle: environment === 'production' ? project : `${project}@${environment}`,
  expiresAt,
  facts,
})

/** What a backend knows that verifying a request needs: its own Vercel project, and the OIDC issuers its rules trust. */
export type AuthenticateContext = {
  /** The board's own Vercel project and team: its people's development tokens are for it. */
  project(): Promise<{ id: string | null; teamId: string | null }>
  /** OIDC issuers past Vercel's and GitHub's whose tokens may be trusted: the ones `oidc()` rules name. */
  issuers: readonly string[]
}

/**
 * Who a request is, in the board's ID scheme: `verifyTokens()` checks its bearer token for the
 * board's URL, and a host's own verifier recognizes its own credentials (a session cookie in
 * `request.headers`, say). To reject, return or throw a `Response`, or throw an `HttpError`;
 * anything else thrown is a 500. What a principal may do is the backend's: `a2({ access })`.
 */
export type Authenticate = (
  request: CallerRequest,
  board: AuthenticateContext,
) => Principal | HostPrincipal | Response | Promise<Principal | HostPrincipal | Response>

/** What a host's own verifier returns: a principal in the board's ID scheme. */
export type HostPrincipal = {
  /** `vercel:user:<id>`, `vercel:project:<id>:<env>`, …: records keep their shape. */
  id: string
  kind: PrincipalKind
  handle: string
  expiresAt?: Date | null
}

const TOKENS = Symbol('vboard.verifyTokens')

/**
 * The built-in verifier: a request's bearer token, from Vercel (people and deployments), GitHub
 * Actions, an `oidc()` rule's issuer, or `local`'s, verified for the board's URL. A request with
 * no token is a 401.
 */
export function verifyTokens(options: VerifyTokensOptions = {}): Authenticate {
  let made: { issuers: string; verify: ReturnType<typeof createVerifier>['verify'] } | null = null
  const authenticate: Authenticate = async (request, board) => {
    if (request.credential === null) throw unauthorized('missing bearer token')
    const issuers = board.issuers.join('\n')
    if (made?.issuers !== issuers)
      made = {
        issuers,
        verify: createVerifier({
          projectId: async () => (await board.project()).id,
          teamId: async () => (await board.project()).teamId,
          issuers: board.issuers,
          auth: options,
        }).verify,
      }
    return made.verify(request.credential, request.audience, request.headers.get('x-vercel-oidc-token') ?? undefined)
  }
  return Object.assign(authenticate, { [TOKENS]: true })
}

/** Whether `authenticate` is `verifyTokens()`'s: what it returns are token principals, not a host's. */
export const verifiesTokens = (authenticate: Authenticate) => TOKENS in authenticate

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
  if (typeof value.id !== 'string' || !PRINCIPAL_ID.test(value.id) || value.id.startsWith('vboard:'))
    fail(`id must look like \`vercel:user:<id>\`, got ${JSON.stringify(value.id)}`)
  if (!KINDS.includes(value.kind)) fail(`kind must be one of ${KINDS.join(', ')}`)
  if (typeof value.handle !== 'string' || !/^\S{1,64}$/.test(value.handle)) fail('handle must be 1-64 characters, no spaces')
  const expiresAt = value.expiresAt ?? null
  if (expiresAt !== null && (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime()))) fail('expiresAt must be a Date or null')
  if (expiresAt !== null && expiresAt.getTime() <= Date.now()) throw unauthorized('token expired')
  const claims: Record<string, number> = expiresAt === null ? {} : { exp: Math.floor(expiresAt.getTime() / 1000) }
  return { id: value.id, kind: value.kind, handle: value.handle, expiresAt, facts: { issuer: 'host', iss: '', claims } }
}
