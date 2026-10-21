import type { Protocol } from '../api/protocol.ts'
import type { BoardClient } from '../client/client.ts'
import type { Access } from './access.ts'
import type { Principal } from './auth.ts'
import type { WatcherContext } from './watch.ts'
import type { Identity, WriteOrigin } from './writes.ts'

/** Who's calling a backend's method. Every method honors what the caller may do. */
export type Caller =
  /**
   * A request board() verified, or a write a backend makes in-process for someone it trusts:
   * the principal, the actor it writes as, and its access (`identity.principal.access`).
   */
  | { identity: Identity; origin: WriteOrigin }
  /**
   * This deployment's own code, writing as `self`: `client(name)`, or a watcher. Each backend
   * decides who that is on its board: `vboard:client:<name>` on a2(), `<principal>+<name>` elsewhere.
   */
  | { self: string; origin: WriteOrigin }

/** One method per protocol route: the caller, the parsed input, and the request's signal. */
export type ProtocolMethods = {
  [M in keyof Protocol]: (caller: Caller, input: Protocol[M]['input'], signal: AbortSignal) => Promise<Protocol[M]['output']>
}

/** A route of a backend's own, beside the protocol: a2()'s stuck list, http()'s wake-ups. */
export type BackendRoute = {
  method: 'GET' | 'POST'
  /** Under the board's mount, with `:param` segments, e.g. `/stuck` or `/webhooks/:key`. */
  path: string
  /** Whether board() verifies the caller first. A webhook or a wake-up carries no board token. */
  auth: boolean
  handle(request: Request, context: { caller: Caller | null; param: string | null }): Promise<Response>
}

/** What a backend gets from the board it serves: once, in memory, when board() is created. */
export type BoardBinding = {
  /** This project's watchers, by ID. */
  watch: Record<string, { tail: string; when: 'matches' | 'enters' }>
  /** Runs one of this project's watchers on an event. A throw is the backend's to retry. */
  run(watcher: string, event: WatcherContext['event'], meta: { trigger: string }): Promise<void>
  /**
   * What a stored principal (a schedule's creator, a watcher's registrant) may do now, under the
   * board's rules as they are: null once it may do nothing. Background work checks with it.
   */
  accessFor(principal: Pick<Principal, 'id' | 'kind' | 'facts' | 'scope'>): Promise<Access | null>
  /** An in-process client through the board, as `caller`. Its posts get IDs derived from `trigger`. */
  client(caller: Caller, trigger: string | null): BoardClient
  /** The board's own URL, where a board elsewhere can wake it, once it's known. */
  url(): string | null
}

/**
 * Where a board lives. board() serves the protocol over HTTP: it routes, validates, verifies
 * tokens, applies the access rules, and calls these. A backend stores and answers.
 */
export interface Backend extends ProtocolMethods {
  /** Set when this backend keeps nothing here: discovery sends clients to that board instead. */
  readonly remote: string | null
  /** Its sync entries, for discovery. */
  readonly sync: readonly { key: string; platform: string }[]
  /** Routes of its own, beside the protocol. */
  readonly routes: readonly BackendRoute[]
  /**
   * board() calls it once, when it's created, before any request: what background work needs
   * from the board (its rules, its watchers, an in-process client). It does no I/O.
   */
  bind(board: BoardBinding): void
}
