import { reducer } from 'experimental-a2'
import { createServer } from 'experimental-a2/server'
import type { Protocol } from '../api/protocol.ts'
import type { GrantView, PrincipalView, TokenView } from '../api/routes.ts'
import { duration } from '../client/client.ts'
import { ACCESS_SESSION, accessContract, type AccessEvent } from '../contract/contract.ts'
import { SCOPE_MAX } from '../contract/schemas.ts'
import { compileAccess, FULL_ACCESS, parseScope, patternsOf, scopeOf, type Access, type Can, type WrittenCan } from './access.ts'
import {
  BOARD_TOKEN_PREFIX,
  checkCan,
  checkGrant,
  checkPrincipal,
  DEFAULT_CAN,
  GITHUB_ISSUER,
  grantIssuers,
  issuerName,
  joined,
  principalKey,
  removes,
  tokenHash,
  workflowPath,
  type GrantPrincipal,
  type Known,
  type Principal,
  type StoredGrant,
} from './auth.ts'
import type { Identity, StoredToken, Trust } from './backend.ts'
import type { Decided } from './policy.ts'
import { badRequest, forbidden, notFound, unauthorized } from './errors.ts'

/** How long a token lives when its minter doesn't say, and at most: npm caps its write tokens at 90 days. */
export const TOKEN_DEFAULT_MS = 30 * 24 * 3600_000
export const TOKEN_MAX_MS = 90 * 24 * 3600_000
/** How deep tokens minted with tokens go: each request walks the chain to its root. */
const TOKEN_DEPTH_MAX = 8

/** A grant as the fold keeps it: `event` is the index of the event that made it, null for the one the board starts with. */
type GrantRow = { id: number; event: number | null; principals: GrantPrincipal[]; can: WrittenCan; by: string | null; at: number | null }
type TokenRow = {
  id: number
  hash: string
  name: string
  minter: Known
  profile: string | null
  avatar: string | null
  session: string | null
  handle: string | null
  personName: string | null
  expiresAt: number
  parent: number | null
  by: string
  at: number
}
/**
 * Grants by ID, and the next ID; live tokens by ID, and their IDs by hash. A revoked token leaves
 * the state at once, and an expired one with the first event of the day after it expires: its
 * token IDs wait in `expiring`, by that day. The log keeps every event.
 */
export type AccessState = {
  grants: Record<string, GrantRow>
  nextGrant: number
  tokens: Record<string, TokenRow>
  hashes: Record<string, number>
  expiring: Record<string, number[]>
  /** The first day not yet pruned: the day of the first event, until then. */
  pruned: number | null
}

/**
 * The grants a board starts with, as a team's board in Vercel's API does: g1, every person may do
 * everything (no team roles cap it here), and g2, every project on the board's team, in every
 * environment, reads, posts, reacts, and labels everywhere. Revoke or change them like any other.
 */
const STARTING_GRANTS: Record<string, GrantRow> = {
  1: { id: 1, event: null, principals: [{ kind: 'all-users' }], can: { '*': 'all' }, by: null, at: null },
  2: {
    id: 2,
    event: null,
    principals: [{ kind: 'all-projects', environments: ['production', 'preview', 'development'] }],
    can: { '*': ['read', 'post', 'react', 'label'] },
    by: null,
    at: null,
  },
}

/** The access session before its first event: the grants every board starts with, and no tokens. */
export const startingAccess = (): AccessState => ({ grants: structuredClone(STARTING_GRANTS), nextGrant: 3, tokens: {}, hashes: {}, expiring: {}, pruned: null })

const DAY_MS = 24 * 3600_000

function dropToken(state: AccessState, id: number) {
  const row = state.tokens[id]
  if (!row) return
  delete state.hashes[row.hash]
  delete state.tokens[id]
}

/** Whether token `id` is token `ancestor`, or was minted with it at any depth. */
function mintedWith(state: AccessState, id: number, ancestor: number): boolean {
  let at: number | null = id
  for (let depth = 0; at !== null && depth <= TOKEN_DEPTH_MAX; depth++) {
    if (at === ancestor) return true
    at = state.tokens[at]?.parent ?? null
  }
  return false
}

/**
 * Whether `identity` may see and revoke token `row`: anyone's with `manage` in every channel. A
 * token acts as its minter, so its principal alone would hand it every token its minter has: with
 * a token, it's that token and those minted with it; without one, those its principal minted.
 */
function manages(state: AccessState, { principal }: Identity, row: TokenRow): boolean {
  if (principal.access.everywhere('manage')) return true
  if (row.minter.id !== principal.id) return false
  if (principal.token === undefined) return true
  const held = indexOf(principal.token, 't')
  return held !== null && mintedWith(state, row.id, held)
}

/**
 * The access session's fold. It prunes by the events' own times, so every instance folds the same
 * state, and each event costs a day's expired tokens at most. A child whose parent is gone counts
 * as dead (`liveIn`), and lives no longer than its parent, so pruning never brings one back.
 */
export function foldAccess(state: AccessState, event: AccessEvent): AccessState {
  const at = new Date(event.createdAt).getTime()
  const day = Math.floor(at / DAY_MS)
  if (state.pruned === null) state.pruned = day
  for (; state.pruned < day; state.pruned++) {
    for (const id of state.expiring[state.pruned] ?? []) dropToken(state, id)
    delete state.expiring[state.pruned]
  }
  switch (event.type) {
    // From before grants named principals: they name no one now.
    case 'grant.set':
    case 'grant.revoked':
      break
    case 'grant.created': {
      const { principals, can, by } = event.payload
      const id = state.nextGrant++
      state.grants[id] = { id, event: event.index, principals: principals as GrantPrincipal[], can: can as WrittenCan, by, at }
      break
    }
    case 'grant.updated': {
      const { id, principals, can, by } = event.payload
      const row = state.grants[id]
      if (row) Object.assign(row, { principals: principals as GrantPrincipal[], can: can as WrittenCan, by, at })
      break
    }
    case 'grant.deleted':
      delete state.grants[event.payload.id]
      break
    case 'token.minted': {
      const { payload } = event
      if (state.hashes[payload.hash] !== undefined) break
      state.tokens[event.index] = { id: event.index, ...payload, minter: payload.minter as Known, at }
      state.hashes[payload.hash] = event.index
      ;(state.expiring[Math.floor(payload.expiresAt / DAY_MS)] ??= []).push(event.index)
      break
    }
    case 'token.revoked':
      dropToken(state, event.payload.id)
      break
  }
  return state
}

export const accessReducer = reducer({
  contract: accessContract,
  // v2 since grants name principals: what v1 folded is folded again.
  name: 'board.access.v2',
  initialState: startingAccess(),
}).fold(foldAccess)

const grantId = (id: number) => `g${id}`
const tokenId = (id: number) => `t${id}`
/** The index an ID names: `g12` or `t12` for 12. Null for one that names none. */
function indexOf(id: string, prefix: 'g' | 't'): number | null {
  const found = new RegExp(`^${prefix}([1-9]\\d{0,15})$`).exec(id)
  return found ? Number(found[1]) : null
}

/** A principal as views show it: the IDs, and the names the board knows, which on `a2()` are none. */
function principalView(principal: GrantPrincipal): PrincipalView {
  switch (principal.kind) {
    case 'user':
      return { kind: 'user', userId: principal.userId, email: principal.email ?? null }
    case 'project':
      return { kind: 'project', projectId: principal.projectId, name: principal.name ?? null, environments: [...principal.environments] }
    case 'github':
      return { ...principal, repositoryId: principal.repositoryId ?? null }
    case 'oidc':
      return { kind: 'oidc', issuer: principal.issuer, claims: Object.fromEntries(Object.entries(principal.claims).map(([name, value]) => [name, typeof value === 'string' ? value : [...value]])) }
    case 'all-projects':
      return { kind: 'all-projects', environments: [...principal.environments] }
    default:
      return { kind: principal.kind }
  }
}

const grantView = (row: GrantRow): GrantView => ({
  id: grantId(row.id),
  principals: row.principals.map(principalView),
  can: Object.fromEntries(Object.entries(row.can).map(([pattern, grant]) => [pattern, grant === 'all' ? 'all' : [...grant]])) as GrantView['can'],
  // A board on `a2()` has no team roles.
  capped: false,
  by: row.by,
  at: row.at === null ? null : new Date(row.at).toISOString(),
})

const storedGrant = (row: GrantRow): StoredGrant => ({ id: grantId(row.id), principals: row.principals, can: row.can })

/** A token as the protocol shows it, with `can` what it may do now (`accessNow`'s, for its minter). */
const tokenView = (row: TokenRow, can: Access | null): TokenView => ({
  id: tokenId(row.id),
  name: row.name,
  can: (can === null ? {} : can.summary()) as TokenView['can'],
  profile: row.profile,
  session: row.session,
  by: row.by,
  at: new Date(row.at).toISOString(),
  expiresAt: new Date(row.expiresAt).toISOString(),
  parent: row.parent === null ? null : tokenId(row.parent),
})

/** A new token's secret: the prefix and 32 random bytes, base64url. */
function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `${BOARD_TOKEN_PREFIX}${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/**
 * The principal an explain query names, as a token of its would make it: a person by user ID, a
 * project's deployment in one environment (production unless it says) on the board's team, a
 * repository's run with what it says of its workflow, branch, and event, or an issuer's token with
 * its claims. A board that verifies tokens itself looks no names up, so a name is a 400.
 */
function principalNamed(query: Protocol['explain']['input'], team: string | null): Known {
  if (query.user !== undefined) {
    if (query.user.includes('@')) throw badRequest(`this board can't look up ${query.user}: it verifies tokens itself, so name the user by ID`)
    return { id: `vercel:user:${query.user}`, kind: 'person', handle: query.user }
  }
  if (query.project !== undefined) {
    if (!/^prj_[A-Za-z0-9]+$/.test(query.project)) throw badRequest(`this board can't look up the project ${query.project}: it verifies tokens itself, so name it by ID, prj_…`)
    const environment = query.environment ?? 'production'
    const claims = { project_id: query.project, environment, ...(team !== null ? { owner_id: team } : {}) }
    return { id: `vercel:project:${query.project}:${environment}`, kind: 'deployment', handle: query.project, facts: { issuer: 'vercel', iss: '', claims, ...(team !== null ? { team } : {}) } }
  }
  if (query.github !== undefined) {
    const repository = query.github
    const claims: Record<string, string> = { repository }
    if (query.workflow !== undefined) claims.workflow_ref = `${repository}/${workflowPath(query.workflow)}@refs/heads/${query.branch ?? 'main'}`
    if (query.branch !== undefined) claims.ref = `refs/heads/${query.branch}`
    if (query.event !== undefined) claims.event_name = query.event
    return { id: `github:repo:${repository}`, kind: 'workflow', handle: repository, facts: { issuer: 'github', iss: GITHUB_ISSUER, claims } }
  }
  const iss = query.oidc!
  const claims: Record<string, string> = {}
  for (const pair of query.claim ?? []) {
    const at = pair.indexOf('=')
    if (at <= 0) throw badRequest(`a claim is name=value, and ${pair} isn't one`)
    claims[pair.slice(0, at)] = pair.slice(at + 1)
  }
  let name: string
  try {
    name = issuerName(iss)
  } catch {
    throw badRequest(`an oidc issuer is an https URL, got ${iss}`)
  }
  return { id: `oidc:${name}:${claims.sub ?? 'explain'}`, kind: 'workflow', handle: claims.sub ?? 'oidc', facts: { issuer: 'oidc', iss, claims } }
}

/**
 * Whether `identity` may change grants at `pattern`: `manage` there, as its access resolves at that
 * pattern itself, so `*` is what `*` gives whatever a channel locks. The board's people (a local
 * board's local user) are its owners, who always may, as far as a token they came with allows.
 */
function managesAt({ principal }: Identity, pattern: string): boolean {
  if (principal.access.at('manage', pattern)) return true
  if (principal.kind !== 'person') return false
  return principal.scope === undefined || compileAccess(parseScope(principal.scope)).at('manage', pattern)
}

/** Every pattern in `patterns` that `identity` may change grants at, or a 403 naming the first it can't. */
function mayChange(identity: Identity, patterns: Iterable<string>, what: string) {
  for (const pattern of patterns)
    if (!managesAt(identity, pattern)) throw forbidden(`this token can't ${what}: it needs manage at ${pattern}`)
}

/**
 * The board's grants and tokens, in session `access` of its log: what `a2()` answers for them, and
 * what board() checks requests against. `issuers`: the OIDC issuers the board's rules name, which no
 * grant's may share principals with. `accessNow`: what a principal may do now, under board()'s
 * rules and grants, which a token's listing shows.
 */
export function createTrust(options: {
  store: Parameters<typeof createServer>[0]['store']
  issuers: () => readonly string[]
  accessNow: (principal: Known) => Promise<Access | null>
  /** What decides a channel for a principal, under board()'s rules and grants. */
  explain: (principal: Known, channel: string) => Promise<Decided>
  /** The board's own Vercel team, when it's known: a project explain names is taken to be on it. */
  team: () => Promise<string | null>
}) {
  const session = createServer({ contract: accessContract, store: options.store }).session(ACCESS_SESSION)
  const read = async () => (await session.state(accessReducer)).state

  /**
   * What each of `rows` may do now: its minter's access, narrowed by its scope. A minter's is worked
   * out once, however many tokens it has.
   */
  async function viewsOf(rows: readonly TokenRow[]): Promise<TokenView[]> {
    const minters = new Map<string, Promise<Access | null>>()
    return Promise.all(
      rows.map(async (row) => {
        const { scope, ...minter } = row.minter
        const key = JSON.stringify(minter)
        let access = minters.get(key)
        if (!access) minters.set(key, (access = options.accessNow(minter)))
        const now = await access
        return tokenView(row, now === null || scope === undefined ? now : now.narrow(parseScope(scope)))
      }),
    )
  }

  /** Whether token `id` and every token it was minted with are live now. */
  function liveIn(state: AccessState, id: number): boolean {
    let at: number | null = id
    for (let depth = 0; at !== null; depth++) {
      const row: TokenRow | undefined = state.tokens[at]
      if (!row || row.expiresAt <= Date.now() || depth > TOKEN_DEPTH_MAX) return false
      at = row.parent
    }
    return true
  }

  const trust: Trust = {
    async grants(): Promise<StoredGrant[]> {
      return Object.values((await read()).grants).map(storedGrant)
    },
    async token(hash): Promise<StoredToken | null> {
      const state = await read()
      const id = state.hashes[hash]
      if (id === undefined || !liveIn(state, id)) return null
      const row = state.tokens[id]!
      return {
        id: tokenId(row.id),
        name: row.name,
        minter: row.minter,
        pinned: { profile: row.profile, avatar: row.avatar, session: row.session, handle: row.handle, name: row.personName },
        expiresAt: new Date(row.expiresAt),
      }
    },
    async live(id) {
      const index = indexOf(id, 't')
      return index !== null && liveIn(await read(), index)
    },
  }

  return {
    trust,
    async grants(identity: Identity): Promise<Protocol['grants']['output']> {
      mayChange(identity, ['*'], 'list grants')
      return { grants: Object.values((await read()).grants).sort((a, b) => a.id - b.id).map(grantView) }
    },
    async createGrant(identity: Identity, body: Protocol['createGrant']['input']): Promise<Protocol['createGrant']['output']> {
      const before = await read()
      const checked = checkGrant(body, [...options.issuers(), ...grantIssuers(Object.values(before.grants).map(storedGrant))])
      mayChange(identity, patternsOf(checked.can), 'create this grant')
      const [row] = await session.append({ type: 'grant.created', payload: { principals: checked.principals as never, can: checked.can as never, by: identity.actor.id } })
      const made = row && Object.values((await read()).grants).find((grant) => grant.event === row.index)
      if (!made) throw new Error('a grant was made but its log has no record of it')
      return { grant: grantView(made) }
    },
    async updateGrant(identity: Identity, { id, add, remove, can }: Protocol['updateGrant']['input']): Promise<Protocol['updateGrant']['output']> {
      const state = await read()
      const index = indexOf(id, 'g')
      const row = index === null ? undefined : state.grants[index]
      if (!row) throw notFound(`grant not found: ${id}`, 'grant_not_found')
      mayChange(identity, patternsOf(row.can), `update ${id}`)
      const trusted = [...options.issuers(), ...grantIssuers(Object.values(state.grants).filter((other) => other.id !== row.id).map(storedGrant))]
      let principals = [...row.principals]
      for (const input of remove ?? []) {
        const removal = checkPrincipal(input, trusted, true)
        const kept = principals.filter((principal) => !removes(removal, principal))
        if (kept.length === principals.length) throw badRequest(`${id} doesn't name that ${removal.kind} principal`, 'not_in_grant')
        principals = kept
      }
      for (const input of add ?? []) {
        const added = checkPrincipal(input, trusted)
        const at = principals.findIndex((principal) => joined(added, principal) !== null)
        if (at === -1) principals.push(added)
        else principals[at] = joined(added, principals[at]!)!
      }
      if (principals.length === 0) throw badRequest(`that leaves ${id} naming no one: revoke it instead`, 'grant_empty')
      if (principals.length > 32) throw badRequest('a grant names at most 32 principals', 'invalid_grant')
      const next = can === undefined ? row.can : checkCan(can)
      mayChange(identity, patternsOf(next), `update ${id}`)
      await session.append({ type: 'grant.updated', payload: { id: row.id, principals: principals as never, can: next as never, by: identity.actor.id } })
      return { grant: grantView((await read()).grants[row.id]!) }
    },
    async explain(identity: Identity, query: Protocol['explain']['input']): Promise<Protocol['explain']['output']> {
      const named = query.user !== undefined || query.project !== undefined || query.github !== undefined || query.oidc !== undefined
      // What anyone else may do shows the grants, which only those who may list them see.
      if (named) mayChange(identity, ['*'], 'explain what another principal may do')
      const { id, kind, handle, facts, scope, token } = identity.principal
      const principal: Known = named ? principalNamed(query, await options.team()) : { id, kind, handle, ...(facts ? { facts } : {}), ...(scope !== undefined ? { scope } : {}), ...(token !== undefined ? { token } : {}) }
      const decided = await options.explain(principal, query.channel)
      const { grants } = await read()
      // A grant names whom else it lets in: only those who may list grants see which decided.
      const shown = managesAt(identity, '*') ? decided.grants : []
      return {
        channel: query.channel,
        pattern: decided.pattern,
        over: decided.over,
        level: decided.level,
        grants: shown.flatMap((grant) => {
          const row = grants[indexOf(grant.id, 'g') ?? 0]
          return row ? [grantView(row)] : []
        }),
        rule: decided.rule,
        // A board on `a2()` has no team roles.
        capped: null,
        can: decided.permissions,
      }
    },
    async revokeGrant(identity: Identity, { id }: { id: string }): Promise<Protocol['revokeGrant']['output']> {
      const index = indexOf(id, 'g')
      const row = index === null ? undefined : (await read()).grants[index]
      if (!row) {
        // One that isn't there is only news to whoever may list them.
        mayChange(identity, ['*'], 'revoke grants')
        return { revoked: false }
      }
      mayChange(identity, patternsOf(row.can), `revoke ${id}`)
      await session.append({ type: 'grant.deleted', payload: { id: row.id, by: identity.actor.id } })
      return { revoked: true }
    },

    async tokens(identity: Identity): Promise<Protocol['tokens']['output']> {
      const state = await read()
      const rows = Object.values(state.tokens).filter((row) => liveIn(state, row.id) && manages(state, identity, row))
      return { tokens: await viewsOf(rows.sort((a, b) => a.id - b.id)) }
    },
    /** The board tokens `principal` came with: its own, then each it was minted with. Undefined with none. */
    async chain(principal: Pick<Principal, 'token'>): Promise<string[] | undefined> {
      if (principal.token === undefined) return undefined
      const state = await read()
      const chain: string[] = []
      for (let at = indexOf(principal.token, 't'); at !== null && chain.length <= TOKEN_DEPTH_MAX; at = state.tokens[at]?.parent ?? null) chain.push(tokenId(at))
      return chain
    },
    async createToken(identity: Identity, body: Protocol['createToken']['input']): Promise<Protocol['createToken']['output']> {
      const { principal, author, actor } = identity
      const state = await read()
      const now = Date.now()
      const asked = body.expires === undefined ? TOKEN_DEFAULT_MS : duration(body.expires)
      if (asked <= 0 || asked > TOKEN_MAX_MS) throw badRequest('a token lives up to 90 days: pass expires as 90d or less', 'invalid_expires')
      let expiresAt = now + asked
      // A token minted with a token is its child: it lives no longer than it, and stops when it does.
      let parent: TokenRow | null = null
      if (principal.token !== undefined) {
        const index = indexOf(principal.token, 't')
        parent = index === null ? null : (state.tokens[index] ?? null)
        if (!parent || !liveIn(state, parent.id)) throw unauthorized("invalid token: revoked, expired, or not this board's")
        let depth = 0
        for (let at: TokenRow | undefined = parent; at; at = at.parent === null ? undefined : state.tokens[at.parent]) depth++
        if (depth >= TOKEN_DEPTH_MAX) throw badRequest(`tokens minted with tokens go ${TOKEN_DEPTH_MAX} deep at most`, 'invalid_token')
        expiresAt = Math.min(expiresAt, parent.expiresAt)
      }
      // What it may do at most: its minter's scope, narrowed by its own `can`. It always has one, so
      // a token is never its principal's integration: no registering watchers, no sync's records.
      let can: ReturnType<typeof compileAccess>
      try {
        can = compileAccess((body.can ?? DEFAULT_CAN) as Can)
      } catch (error) {
        throw badRequest((error as Error).message, 'invalid_scope')
      }
      const scope = scopeOf((principal.scope === undefined ? FULL_ACCESS : compileAccess(parseScope(principal.scope))).narrow(can))
      if (scope.length > SCOPE_MAX) throw badRequest(`a token's can is ${SCOPE_MAX} characters at most as a scope: name fewer channels`, 'invalid_scope')
      const minter: Known = {
        id: principal.id,
        kind: principal.kind,
        handle: principal.handle,
        ...(principal.facts ? { facts: principal.facts } : {}),
        scope,
      }
      // A child keeps its parent's pins: a token can't mint its way out of the profile it writes as.
      const pinned = principal.pinned
      const profile = pinned?.profile ?? body.profile ?? null
      const avatar = pinned?.profile ? pinned.avatar : profile !== null ? (body.avatar ?? null) : null
      const pinnedSession = pinned?.session ?? body.session ?? null
      // A person's handle and name, as this request has them: whoever holds the token sends none.
      const person = principal.kind === 'person'
      const base = author.profile === null ? actor.handle : actor.handle.slice(0, Math.max(0, actor.handle.length - author.profile.length - 1)) || principal.handle
      const handle = pinned?.handle ?? (person ? base : null)
      const personName = pinned?.name ?? (person && author.profile === null ? actor.name : null)
      const secret = newSecret()
      const [row] = await session.append({
        type: 'token.minted',
        payload: { hash: await tokenHash(secret), name: body.name, minter, profile, avatar, session: pinnedSession, handle, personName, expiresAt, parent: parent?.id ?? null, by: actor.id },
      })
      const minted = row && (await read()).tokens[row.index]
      if (!minted) throw new Error('a token was minted but its log has no record of it')
      const [view] = await viewsOf([minted])
      return { token: view!, secret }
    },
    async revokeToken(identity: Identity, { id }: { id: string }): Promise<Protocol['revokeToken']['output']> {
      const state = await read()
      const index = indexOf(id, 't')
      const row = index === null ? undefined : state.tokens[index]
      // Only a live token you manage: one that's gone, never was, or isn't yours answers alike, so
      // it says nothing about others' tokens.
      if (!row || !liveIn(state, row.id) || !manages(state, identity, row)) return { revoked: false }
      await session.append({ type: 'token.revoked', payload: { id: row.id, by: identity.actor.id } })
      return { revoked: true }
    },
  }
}

export type BoardTrust = ReturnType<typeof createTrust>
