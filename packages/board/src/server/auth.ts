import type { JWTPayload, JWTVerifyGetKey } from 'jose'
import type { PrincipalInput } from '../api/routes.ts'
import { combine, compileAccess, FULL_ACCESS, LEVELS, parseScope, writtenCan, type Access, type Can, type Level, type Matched, type WrittenCan } from './access.ts'
import { badRequest, unauthorized, forbidden } from './errors.ts'

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

/** A verified token's claims, as rules match them. */
type TokenClaims = JWTPayload & Record<string, unknown>

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

/** What a rule may compare claims to: the board's own Vercel team and project, when they're known. */
export type MatchContext = { teamId: string | null; projectId: string | null }

/**
 * One entry in `board({ access })`: who it matches, and what they may do. The first entry that
 * matches decides among the rules, and its `can` meets the board's grants as one that names that
 * principal would.
 */
export type AccessRule = {
  /** `vercel` and `github` are their platforms' issuers; `oidc` is the exact `url`. */
  issuer: 'vercel' | 'github' | 'oidc'
  /** For `oidc`: the issuer URL, pinned in code. */
  url?: string
  /** How explain names it: `vercelProject({ project: 'prj_front' })`. */
  name: string
  matches(claims: TokenClaims, context: MatchContext): boolean
  /** What it gives, as written: each pattern it names counts where grants meet it. */
  can: Can
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
    name: `vercelProject({ project: '${options.project}' })`,
    can: options.can,
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
    name: `githubActions({ repository: '${options.repository}' })`,
    can: options.can,
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
    name: `oidc({ issuer: '${options.issuer}' })`,
    can: options.can,
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

/** `oidcTokens()`'s options: tests point these at a local issuer; production uses the defaults. */
export type OidcTokensOptions = {
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
      throw new Error(`access: oidc issuers ${other} and ${iss} name the same principals, oidc:${name}:<sub>: pin one of them`)
    named.set(name, iss)
  }
  return new Set(issuers)
}

/** The OIDC issuers rules name: the only ones whose tokens are verified for them. */
export const issuersOf = (rules: readonly (AccessRule | RuleFunction)[]) =>
  [...new Set(rules.flatMap((rule) => (typeof rule !== 'function' && rule.issuer === 'oidc' ? [rule.url!] : [])))]

/**
 * What a host's own model gives a principal: what it may do, or null for nothing. It sees only the
 * principals its own `authenticate` returned.
 */
export type AccessFunction = (principal: Known) => Can | null | undefined | Promise<Can | null | undefined>

/**
 * A rule of your own, among `vercelProject()` and the rest: what it gives a principal (`'all'`,
 * `['read']`, `{ 'support/': ['read', 'post'] }`), null for nothing, or undefined to leave it to the
 * next rule. It's asked whenever a principal acts, a schedule's send included, and never about a
 * person or the board's own deployments in its environment, which the defaults decide first.
 */
export type RuleFunction = (principal: Known) => Can | null | undefined | Promise<Can | null | undefined>

/** A principal as the board keeps it to work its access out again: who it is, its token's facts, its scope, and the board token it came with. */
export type Known = Pick<Principal, 'id' | 'kind' | 'handle' | 'facts' | 'scope' | 'token'>

/**
 * Who a grant names, as the board keeps it: IDs, with the names it knows beside them. A board
 * that verifies tokens itself knows none, so it keeps what was written: a user's ID, a project's
 * ID, a repository's `owner/name`.
 */
export type GrantPrincipal =
  | { kind: 'user'; userId: string; email?: string }
  | { kind: 'project'; projectId: string; name?: string; environments: readonly string[] }
  | { kind: 'github'; repository: string; repositoryId?: string; workflow?: string; branch?: string; event?: string }
  | { kind: 'oidc'; issuer: string; claims: Readonly<Record<string, string | readonly string[]>> }
  | { kind: 'all-users' }
  | { kind: 'all-projects'; environments: readonly string[] }
  | { kind: 'everyone' }

/** A grant the board keeps: who it names, and one `can` for all of them, as written. */
export type StoredGrant = { id: string; principals: readonly GrantPrincipal[]; can: WrittenCan }

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

const GRANT_PRINCIPALS_MAX = 32
/** The environments every Vercel project has: the only ones a grant for every project may name. */
export const TEAM_ENVIRONMENTS: readonly string[] = ['production', 'preview', 'development']
const PROJECT_ID = /^prj_[A-Za-z0-9]+$/
const USER_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** An OIDC issuer a grant may name: an https URL on the internet, not Vercel's or GitHub's, which have kinds of their own. */
function checkIssuer(issuer: string, trusted: readonly string[]) {
  let url: URL
  try {
    url = new URL(issuer)
  } catch {
    throw invalidGrant(`an oidc principal's issuer is an https URL, got ${issuer}`)
  }
  if (VERCEL_ISSUER.test(issuer)) throw invalidGrant("name Vercel's deployments as a project or all-projects, not as an oidc issuer")
  if (issuer === GITHUB_ISSUER) throw invalidGrant("name GitHub Actions runs as a github principal, not as an oidc issuer")
  if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password)
    throw invalidGrant(`an oidc principal's issuer is an https URL with no query or credentials, got ${issuer}`)
  if (privateHost(url.hostname)) throw invalidGrant(`an oidc principal's issuer is on the internet, not ${url.hostname}`)
  const name = issuerName(issuer)
  const other = trusted.find((candidate) => candidate !== issuer && /^https:/.test(candidate) && issuerName(candidate) === name)
  if (other !== undefined) throw invalidGrant(`issuers ${other} and ${issuer} name the same principals, oidc:${name}:<sub>: use ${other}`)
}

/** An issuer's claims, keys and lists sorted: at least one, since an issuer signs tokens for everyone it serves. */
function checkClaims(issuer: string, given: Readonly<Record<string, string | readonly string[]>>): Record<string, string | string[]> {
  const entries = typeof given === 'object' && given !== null ? Object.entries(given) : []
  if (entries.length === 0) throw invalidGrant(`name at least one claim for ${issuer}: its issuer signs tokens for everyone it serves`)
  if (entries.length > GRANT_CLAIMS_MAX) throw invalidGrant(`an oidc principal names at most ${GRANT_CLAIMS_MAX} claims`)
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
  return claims
}

/** Environments without repeats, in Vercel's order (production, preview, development), then custom ones by ID. */
const environmentsOf = (given: readonly string[]) => {
  const rank = (environment: string) => (TEAM_ENVIRONMENTS.includes(environment) ? TEAM_ENVIRONMENTS.indexOf(environment) : TEAM_ENVIRONMENTS.length)
  return [...new Set(given)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** `ci.yml` is `.github/workflows/ci.yml`, as GitHub names a workflow in a token's `workflow_ref`. */
const workflowPath = (workflow: string) => (workflow.includes('/') ? workflow : `.github/workflows/${workflow}`)

/**
 * A principal as a board that verifies tokens itself keeps it, or a 400 `invalid_grant` that says
 * what to write. Such a board has nothing to look a name up with, so it takes IDs: a user's ID, a
 * project's `prj_…`, and a repository's `owner/name`, which it matches on the token's claims.
 * `removal`: one to take out of a grant, which names a project without its environments.
 */
export function checkPrincipal(input: PrincipalInput, trusted: readonly string[], removal = false): GrantPrincipal {
  switch (input.kind) {
    case 'user':
      if (input.email !== undefined && input.userId !== undefined) throw invalidGrant('a user is its email or its userId, not both')
      if (input.email !== undefined) throw invalidGrant(`this board can't look up ${input.email}: it verifies tokens itself, so name the user by ID, { kind: 'user', userId }`)
      if (input.userId === undefined || !USER_ID.test(input.userId)) throw invalidGrant("a user is its userId, letters, numbers, and ._-")
      return { kind: 'user', userId: input.userId }
    case 'project': {
      if (!PROJECT_ID.test(input.project)) throw invalidGrant(`this board can't look up the project ${input.project}: it verifies tokens itself, so name it by ID, prj_…`)
      if (removal) return { kind: 'project', projectId: input.project, environments: [] }
      if (input.environments === undefined) throw invalidGrant(`a project names the environments its deployments get in from, like ['production']`)
      return { kind: 'project', projectId: input.project, environments: environmentsOf(input.environments) }
    }
    case 'all-projects': {
      if (removal) return { kind: 'all-projects', environments: [] }
      if (input.environments === undefined) throw invalidGrant(`all-projects names the environments its deployments get in from, like ['production']`)
      const custom = input.environments.filter((environment) => !TEAM_ENVIRONMENTS.includes(environment))
      if (custom.length > 0) throw invalidGrant(`all-projects names production, preview, or development: ${custom[0]} is one project's`)
      return { kind: 'all-projects', environments: environmentsOf(input.environments) }
    }
    case 'github':
      if (!REPOSITORY.test(input.repository)) throw invalidGrant(`a github principal's repository is owner/name, got ${input.repository}`)
      return {
        kind: 'github',
        repository: input.repository,
        ...(input.workflow !== undefined ? { workflow: workflowPath(input.workflow) } : {}),
        ...(input.branch !== undefined ? { branch: input.branch.replace(/^refs\/heads\//, '') } : {}),
        ...(input.event !== undefined ? { event: input.event } : {}),
      }
    case 'oidc':
      checkIssuer(input.issuer, trusted)
      return { kind: 'oidc', issuer: input.issuer, claims: checkClaims(input.issuer, input.claims) }
    case 'all-users':
    case 'everyone':
      return { kind: input.kind }
  }
}

/** One principal's key: two that share it are the same principal. */
export const principalKey = (principal: GrantPrincipal) => JSON.stringify(principal)

/** Principals checked, without repeats, and a `can` kept as written: what a board that verifies tokens itself stores of a grant. */
export function checkGrant(body: { principals: readonly PrincipalInput[]; can: unknown }, trusted: readonly string[]): { principals: GrantPrincipal[]; can: WrittenCan } {
  if (body.principals.length === 0) throw invalidGrant('a grant names at least one principal')
  if (body.principals.length > GRANT_PRINCIPALS_MAX) throw invalidGrant(`a grant names at most ${GRANT_PRINCIPALS_MAX} principals`)
  // Each against the issuers before it in the grant too: two that name the same principals can't sit side by side.
  const seen = [...trusted]
  const checked = body.principals.map((input) => {
    const principal = checkPrincipal(input, seen)
    if (principal.kind === 'oidc') seen.push(principal.issuer)
    return principal
  })
  const principals = [...new Map(checked.map((principal) => [principalKey(principal), principal])).values()]
  return { principals, can: checkCan(body.can) }
}

/** A grant's `can`, as written, or a 400 `invalid_grant`. */
export function checkCan(can: unknown): WrittenCan {
  try {
    return writtenCan(can)
  } catch (error) {
    throw invalidGrant((error as Error).message)
  }
}

/**
 * Whether `removal` takes `principal` out of a grant: the same user, project, or issuer and
 * claims, whatever its environments; a repository's principals with the workflow, branch, and
 * event it names, any of them where it names none; a group or everyone by its kind.
 */
export function removes(removal: GrantPrincipal, principal: GrantPrincipal): boolean {
  if (removal.kind !== principal.kind) return false
  switch (removal.kind) {
    case 'user':
      return removal.userId === (principal as typeof removal).userId
    case 'project':
      return removal.projectId === (principal as typeof removal).projectId
    case 'github': {
      const other = principal as typeof removal
      return (
        removal.repository === other.repository &&
        (removal.workflow === undefined || removal.workflow === other.workflow) &&
        (removal.branch === undefined || removal.branch === other.branch) &&
        (removal.event === undefined || removal.event === other.event)
      )
    }
    case 'oidc': {
      const other = principal as typeof removal
      return removal.issuer === other.issuer && JSON.stringify(removal.claims) === JSON.stringify(other.claims)
    }
    default:
      return true
  }
}

/**
 * `added` joined into `principal` when it's the same principal, as a removal would find it: a
 * project's environments, or every project's, together. Null when it's another principal. Adding
 * never narrows what a grant names; a remove and an add in one update do.
 */
export function joined(added: GrantPrincipal, principal: GrantPrincipal): GrantPrincipal | null {
  if (added.kind !== principal.kind) return null
  if (added.kind === 'project' || added.kind === 'all-projects') {
    const other = principal as typeof added
    if (added.kind === 'project' && added.projectId !== (other as typeof added).projectId) return null
    return { ...other, environments: environmentsOf([...other.environments, ...added.environments]) }
  }
  return principalKey(added) === principalKey(principal) ? principal : null
}

/** A person's user ID: `vercel:user:u_123` is `u_123`, and a local board's `local:user:jb` is `jb`. */
export const userIdOf = (id: string) => id.split(':').slice(2).join(':')

/**
 * How close `principal` is to a caller: `principal` for a user, a project, a repository's runs, or
 * an issuer's claims that are the caller's; `group` for every person (`all-users`) or every
 * project on the board's team (`all-projects`), in its environments; `everyone` for everyone.
 * Null when it doesn't name the caller. `team` is the board's own Vercel team, when it's known.
 */
export function closeness(principal: GrantPrincipal, caller: Known, team: string | null): Level | null {
  const facts = caller.facts
  const claims = facts?.claims ?? {}
  const environment = String(claims.environment ?? '')
  switch (principal.kind) {
    case 'everyone':
      return 'everyone'
    case 'all-users':
      return caller.kind === 'person' ? 'group' : null
    case 'user':
      return caller.kind === 'person' && userIdOf(caller.id) === principal.userId ? 'principal' : null
    case 'all-projects':
      return facts?.issuer === 'vercel' && team !== null && claims.owner_id === team && principal.environments.includes(environment) ? 'group' : null
    case 'project':
      return facts?.issuer === 'vercel' && claims.project_id === principal.projectId && principal.environments.includes(environment) ? 'principal' : null
    case 'github': {
      if (facts?.issuer !== 'github') return null
      const repository = String(claims.repository ?? '')
      const same = principal.repositoryId !== undefined ? String(claims.repository_id ?? '') === principal.repositoryId : repository === principal.repository
      const workflow = principal.workflow === undefined || String(claims.workflow_ref ?? '').startsWith(`${repository}/${principal.workflow}@`)
      const branch = principal.branch === undefined || claims.ref === `refs/heads/${principal.branch}`
      const event = principal.event === undefined || claims.event_name === principal.event
      return same && workflow && branch && event ? 'principal' : null
    }
    case 'oidc':
      return facts?.issuer === 'oidc' &&
        facts.iss === principal.issuer &&
        Object.entries(principal.claims).every(([name, allowed]) => {
          const value = claims[name]
          if (value === undefined) return false
          return typeof allowed === 'string' ? String(value) === allowed : allowed.includes(String(value))
        })
        ? 'principal'
        : null
  }
}

/** How close the closest of a grant's principals is to a caller, or null when it names none of them. */
export function grantLevel(grant: Pick<StoredGrant, 'principals'>, caller: Known, team: string | null): Level | null {
  let best: Level | null = null
  for (const principal of grant.principals) {
    const level = closeness(principal, caller, team)
    if (level !== null && (best === null || LEVELS.indexOf(level) < LEVELS.indexOf(best))) best = level
  }
  return best
}

/**
 * The issuers a verifier trusts for grants, beside the rules': a grant's issuer only while it's an
 * https URL on the internet and names principals no issuer before it does. A board refuses any
 * other when it's granted; one stored before it did is never asked for keys, and never breaks the
 * verifier for everyone else.
 */
export function verifiedIssuers(rules: readonly string[], granted: readonly string[]): string[] {
  const taken = new Set(rules.map(issuerName))
  const issuers = [...rules]
  for (const issuer of granted) {
    if (rules.includes(issuer)) continue
    const url = URL.parse(issuer)
    if (url?.protocol !== 'https:' || privateHost(url.hostname)) continue
    const name = issuerName(issuer)
    if (taken.has(name)) continue
    taken.add(name)
    issuers.push(issuer)
  }
  return issuers
}

/** The OIDC issuers grants name: their tokens are verified too. */
export const grantIssuers = (grants: readonly Pick<StoredGrant, 'principals'>[]) => [
  ...new Set(grants.flatMap((grant) => grant.principals.flatMap((principal) => (principal.kind === 'oidc' ? [principal.issuer] : [])))),
]

/** What decided part of a principal's access: a grant the board keeps, or a rule in its code. */
export type Source = { grant: StoredGrant } | { rule: string }

/**
 * What decides a principal's access: `fixed` for what no grant meets (the board's own code, its
 * own deployments where it runs, a board that keeps no grants), or the rule and the grants that
 * match it, which `combine` meets.
 */
export type Resolved = { fixed: Access; rule: string | null } | { matched: Matched<Source>[] }

/**
 * What principals may do, under a board's rules and grants. The first of the rules that matches a
 * principal (`vercelProject()`, `githubActions()`, `oidc()`, or a function of your own) meets every
 * grant that names it, as a grant naming that principal would: at each channel, the most specific
 * pattern decides, then the closest principal, and ties add up. People are always let in, and the
 * board's own deployments in its environment may do everything. Or a host's own function of the
 * principal, which decides alone.
 */
export function createAuthority(options: {
  access: readonly (AccessRule | RuleFunction)[] | AccessFunction
  /** Whether a host's verifier makes this board's principals: false for one whose verifier is the built-in one alone. */
  hosts: boolean
  /** The board's own Vercel project and team. */
  project: () => Promise<{ id: string | null; teamId: string | null }>
  /** The grants the board keeps, as they are now. Null where it keeps none: there, people may do everything. */
  grants?: (() => Promise<readonly StoredGrant[]>) | null
}) {
  const rules = typeof options.access === 'function' ? [] : options.access
  const host = typeof options.access === 'function' ? options.access : null
  const oidcIssuers = trustedIssuers(issuersOf(rules))

  /** The grants that name `principal`, each as close as its closest principal: of `snapshot`, when given, or as they are now. */
  async function matching(principal: Known, team: string | null, snapshot?: readonly StoredGrant[]): Promise<{ grants: readonly StoredGrant[]; matched: Matched<Source>[] }> {
    const grants = snapshot ?? (options.grants ? await options.grants() : [])
    const matched = grants.flatMap((grant) => {
      const level = grantLevel(grant, principal, team)
      return level === null ? [] : [{ level, can: grant.can, source: { grant } }]
    })
    return { grants, matched }
  }

  /**
   * What decides a token's principal: the first rule that matches it, a token's rule when its
   * facts match or a function when it answers, and the grants that name it. The board's own
   * deployments in its environment get everything unless a token's rule says otherwise, and no
   * function or grant is asked about them. A function that answers null refuses, grants or not.
   * `everyone` lets no one in: a 401 or 403 that says which rule would, when nothing else names it.
   */
  async function byRules(principal: Known, facts: TokenFacts | null, snapshot?: readonly StoredGrant[]): Promise<Resolved> {
    if (facts?.issuer === 'host') throw forbidden("this token can't use this board: its board no longer takes a host's principals")
    const claims = (facts?.claims ?? {}) as TokenClaims
    const own = facts?.issuer === 'vercel' ? await options.project() : null
    const context: MatchContext = own ? { teamId: facts!.team ?? own.teamId, projectId: own.id } : { teamId: null, projectId: null }
    const environment = String(claims.environment ?? '')
    // A deployment in the board's own environment runs the board's code. A
    // preview runs any branch's, so a production board doesn't trust them.
    const here = boardEnvironment()
    const ownDeployment = own !== null && own.id !== null && claims.project_id === own.id
    const ownHere = ownDeployment && here !== null && environment === here
    let ruled: Matched<Source> | null = null
    for (const rule of rules) {
      if (typeof rule === 'function') {
        // A function never takes the default of everything away: only a token's rule replaces it.
        if (ownHere) continue
        const can = await rule(principal)
        if (can === undefined) continue
        if (can === null) throw forbidden("this token can't use this board")
        compileAccess(can)
        ruled = { level: 'principal', can, source: { rule: rule.name ? `${rule.name}()` : 'an access function' } }
        break
      }
      if (facts && rule.issuer === facts.issuer && (rule.issuer !== 'oidc' || rule.url === facts.iss) && rule.matches(claims, context)) {
        ruled = { level: 'principal', can: rule.can, source: { rule: rule.name } }
        break
      }
    }
    if (ownHere) return ruled ? { fixed: compileAccess(ruled.can), rule: (ruled.source as { rule: string }).rule } : { fixed: FULL_ACCESS, rule: null }
    const { grants, matched } = await matching(principal, context.teamId, snapshot)
    if (ruled) matched.unshift(ruled)
    if (ruled || matched.some((found) => found.level !== 'everyone')) return { matched }
    if (!facts) throw forbidden("this token can't use this board")
    // An issuer a grant names is trusted: its token just isn't one the grant lets in.
    const named = grantIssuers(grants)
    if (facts.issuer === 'oidc' && !oidcIssuers.has(facts.iss) && !named.includes(facts.iss)) throw unauthorized(`untrusted issuer: ${facts.iss}`)
    if (facts.issuer === 'oidc' && !oidcIssuers.has(facts.iss)) throw forbidden("this token can't use this board: no grant lets in its claims")
    if (facts.issuer === 'oidc') throw notInAccess(`oidc({ issuer: '${facts.iss}', claims, can })`)
    if (facts.issuer === 'github') throw notInAccess(`githubActions({ repository: '${String(claims.repository)}', can })`)
    if (ownDeployment)
      throw forbidden(
        `this token can't use this board: it runs in ${here ?? 'no Vercel environment'}, so its ${environment || 'unnamed'} deployments need vercelProject({ project: 'self', environments: ['${environment}'], can })`,
      )
    throw notInAccess(`vercelProject({ project: '${String(claims.project ?? '') || String(claims.project_id)}', can })`)
  }

  /**
   * What decides a principal's access, before its scope narrows it: the board's own code and the
   * platform users sync writes as may do everything; a host's function decides alone; a person is
   * always let in, with what the grants that name them give (everything, where the board keeps no
   * grants); anyone else as `byRules` says. A host's principal is what its kind is, until it
   * expires. A 401 or 403 when it may do nothing.
   */
  async function resolve(principal: Known, snapshot?: readonly StoredGrant[]): Promise<Resolved> {
    const hosted = principal.facts?.issuer === 'host'
    // A platform user sync writes as is `external` too, but one a host's verifier returns is the host's to give access.
    if (principal.id.startsWith('board:') || (principal.kind === 'external' && !hosted)) return { fixed: FULL_ACCESS, rule: null }
    if (hosted) {
      // One a host's verifier made, on a board whose verifier is now the built-in one alone, is from before it switched.
      if (!options.hosts) throw forbidden("this token can't use this board: its board no longer takes a host's principals")
      const { exp } = principal.facts!.claims
      if (typeof exp === 'number' && exp * 1000 <= Date.now()) throw unauthorized('token expired')
    }
    if (host) {
      const can = await host(principal)
      if (can === null || can === undefined) throw forbidden("this token can't use this board")
      return { fixed: compileAccess(can), rule: 'access' }
    }
    if (principal.kind === 'person') {
      if (!options.grants) return { fixed: FULL_ACCESS, rule: null }
      return { matched: (await matching(principal, null, snapshot)).matched }
    }
    // A host's says nothing past its ID, as a principal stored before the board kept claims.
    return byRules(principal, (hosted ? undefined : principal.facts) ?? factsFromId(principal.id), snapshot)
  }

  /**
   * What a principal may do now, narrowed by its scope, or under `snapshot`, grants as a write is
   * about to change them. A 401 or 403 when it may do nothing.
   */
  async function grant(principal: Known, snapshot?: readonly StoredGrant[]): Promise<Access> {
    const resolved = await resolve(principal, snapshot)
    const access = 'fixed' in resolved ? resolved.fixed : combine(resolved.matched)
    return principal.scope === undefined ? access : access.narrow(parseScope(principal.scope))
  }

  /** What a stored principal (a schedule's creator, a watcher's registrant) may do now: null once nothing. */
  async function accessNow(principal: Known, snapshot?: readonly StoredGrant[]): Promise<Access | null> {
    try {
      return await grant(principal, snapshot)
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status === 401 || status === 403) return null
      throw error
    }
  }

  return { grant, accessNow, resolve }
}

/**
 * What a principal may do under `rules` (`vercelProject()`, `githubActions()`, `oidc()`, and
 * functions of your own), the first that matches deciding, past the defaults: people, and the
 * board's own deployments in the environment it runs in, may do everything. Its scope narrows what
 * it gets. A 401 or 403 that names the rule that would let it in, when it may do nothing.
 */
export function compileRules(
  rules: readonly (AccessRule | RuleFunction)[],
  board: { project(): Promise<{ id: string | null; teamId: string | null }> },
): (principal: Known) => Promise<Access> {
  return createAuthority({ access: rules, project: () => board.project(), hosts: true }).grant
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

/** What board() knows that verifying a request needs: its own Vercel project, and the OIDC issuers its rules trust. */
export type AuthenticateContext = {
  /** The board's own Vercel project and team: its people's development tokens are for it. */
  project(): Promise<{ id: string | null; teamId: string | null }>
  /** OIDC issuers past Vercel's and GitHub's whose tokens may be trusted: the ones `oidc()` rules name. */
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
 * else thrown is a 500. What a principal may do is `board({ access })`'s to say.
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
