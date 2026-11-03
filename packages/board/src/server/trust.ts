import { reducer } from 'experimental-a2'
import { createServer } from 'experimental-a2/server'
import type { Protocol } from '../api/protocol.ts'
import type { GrantView, TokenView } from '../api/routes.ts'
import { duration } from '../client/client.ts'
import { ACCESS_SESSION, accessContract, type AccessEvent } from '../contract/contract.ts'
import { SCOPE_MAX } from '../contract/schemas.ts'
import { compileAccess, FULL_ACCESS, parseScope, scopeOf, type Can } from './access.ts'
import { BOARD_TOKEN_PREFIX, checkGrant, grantIssuers, tokenHash, type GrantSpec, type Known, type StoredGrant } from './auth.ts'
import type { Identity, StoredToken, Trust } from './backend.ts'
import { badRequest, forbidden, unauthorized } from './errors.ts'

/** How long a token lives when its minter doesn't say, and at most: npm caps its write tokens at 90 days. */
export const TOKEN_DEFAULT_MS = 30 * 24 * 3600_000
export const TOKEN_MAX_MS = 90 * 24 * 3600_000
/** How deep tokens minted with tokens go: each request walks the chain to its root. */
const TOKEN_DEPTH_MAX = 8

type GrantRow = { id: number; issuer: string; claims: Record<string, string | string[]>; can: Can; by: string; at: number }
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
 * Grants by their issuer and claims, which make one grant; live tokens by ID, and their IDs by
 * hash. A revoked token leaves the state at once, and an expired one with the first event of the
 * day after it expires: its token IDs wait in `expiring`, by that day. The log keeps every event.
 */
export type AccessState = {
  grants: Record<string, GrantRow>
  grantKeys: Record<string, string>
  tokens: Record<string, TokenRow>
  hashes: Record<string, number>
  expiring: Record<string, number[]>
  /** The first day not yet pruned: the day of the first event, until then. */
  pruned: number | null
}

const DAY_MS = 24 * 3600_000

/** What makes two grants one: the issuer, and the claims with their names sorted. */
const grantKey = (issuer: string, claims: Record<string, string | string[]>) =>
  JSON.stringify([issuer, Object.keys(claims).sort().map((name) => [name, claims[name]])])

function dropToken(state: AccessState, id: number) {
  const row = state.tokens[id]
  if (!row) return
  delete state.hashes[row.hash]
  delete state.tokens[id]
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
    case 'grant.set': {
      const { issuer, claims, can, by } = event.payload
      const key = grantKey(issuer, claims)
      const existing = state.grants[key]
      if (existing) Object.assign(existing, { can, by, at })
      else {
        state.grants[key] = { id: event.index, issuer, claims, can: can as Can, by, at }
        state.grantKeys[event.index] = key
      }
      break
    }
    case 'grant.revoked': {
      const key = state.grantKeys[event.payload.id]
      if (key !== undefined) {
        delete state.grants[key]
        delete state.grantKeys[event.payload.id]
      }
      break
    }
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
  name: 'board.access.v1',
  initialState: { grants: {}, grantKeys: {}, tokens: {}, hashes: {}, expiring: {}, pruned: null } as AccessState,
}).fold(foldAccess)

const grantId = (id: number) => `g${id}`
const tokenId = (id: number) => `t${id}`
/** The index an ID names: `g12` or `t12` for 12. Null for one that names none. */
function indexOf(id: string, prefix: 'g' | 't'): number | null {
  const found = new RegExp(`^${prefix}([1-9]\\d{0,15})$`).exec(id)
  return found ? Number(found[1]) : null
}

const grantView = (row: GrantRow): GrantView => ({
  id: grantId(row.id),
  issuer: row.issuer,
  claims: row.claims,
  can: compileAccess(row.can).summary() as GrantView['can'],
  by: row.by,
  at: new Date(row.at).toISOString(),
})

const tokenView = (row: TokenRow): TokenView => ({
  id: tokenId(row.id),
  name: row.name,
  can: (row.minter.scope === undefined ? FULL_ACCESS : compileAccess(parseScope(row.minter.scope))).summary() as TokenView['can'],
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

const needsManage = (identity: Identity, what: string) => {
  if (!identity.principal.access.everywhere('manage')) throw forbidden(`this token can't ${what}: it needs manage in every channel`)
}

/**
 * The board's grants and tokens, in session `access` of its log: what `a2()` answers for them, and
 * what board() checks requests against. `issuers`: the OIDC issuers the board's rules name, which no
 * grant's may share principals with.
 */
export function createTrust(options: { store: Parameters<typeof createServer>[0]['store']; issuers: () => readonly string[] }) {
  const session = createServer({ contract: accessContract, store: options.store }).session(ACCESS_SESSION)
  const read = async () => (await session.state(accessReducer)).state

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
      return Object.values((await read()).grants).map((row) => ({ ...grantView(row), can: row.can }))
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
      needsManage(identity, 'list grants')
      return { grants: Object.values((await read()).grants).sort((a, b) => a.id - b.id).map(grantView) }
    },
    async createGrant(identity: Identity, body: Protocol['createGrant']['input']): Promise<Protocol['createGrant']['output']> {
      needsManage(identity, 'set grants')
      const before = await read()
      const checked = checkGrant(body as GrantSpec, [...options.issuers(), ...grantIssuers(Object.values(before.grants))])
      const key = grantKey(checked.issuer, checked.claims)
      const created = before.grants[key] === undefined
      await session.append({ type: 'grant.set', payload: { issuer: checked.issuer, claims: checked.claims, can: checked.can as never, by: identity.actor.id } })
      const row = (await read()).grants[key]!
      return { grant: grantView(row), created }
    },
    async revokeGrant(identity: Identity, { id }: { id: string }): Promise<Protocol['revokeGrant']['output']> {
      needsManage(identity, 'revoke grants')
      const index = indexOf(id, 'g')
      if (index === null || (await read()).grantKeys[index] === undefined) return { revoked: false }
      await session.append({ type: 'grant.revoked', payload: { id: index, by: identity.actor.id } })
      return { revoked: true }
    },

    async tokens(identity: Identity): Promise<Protocol['tokens']['output']> {
      const state = await read()
      const all = identity.principal.access.everywhere('manage')
      const rows = Object.values(state.tokens).filter((row) => liveIn(state, row.id) && (all || row.minter.id === identity.principal.id))
      return { tokens: rows.sort((a, b) => a.id - b.id).map(tokenView) }
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
      // a token is never its principal's integration: no registering watchers, no sync's records, no
      // linking accounts to its minter.
      let can: ReturnType<typeof compileAccess>
      try {
        can = body.can === undefined ? FULL_ACCESS : compileAccess(body.can as Can)
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
      return { token: tokenView(minted), secret }
    },
    async revokeToken(identity: Identity, { id }: { id: string }): Promise<Protocol['revokeToken']['output']> {
      const state = await read()
      const index = indexOf(id, 't')
      const row = index === null ? undefined : state.tokens[index]
      const all = identity.principal.access.everywhere('manage')
      // Only a live token of yours, or anyone's with manage: one that's gone, never was, or is
      // someone else's answers alike, so it says nothing about others' tokens.
      if (!row || !liveIn(state, row.id) || (!all && row.minter.id !== identity.principal.id)) return { revoked: false }
      await session.append({ type: 'token.revoked', payload: { id: row.id, by: identity.actor.id } })
      return { revoked: true }
    },
  }
}

export type BoardTrust = ReturnType<typeof createTrust>
