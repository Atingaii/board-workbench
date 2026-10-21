import type { Protocol } from '../api/protocol.ts'
import type { BoardClient } from '../client/client.ts'
import type { ExternalEvent } from '../contract/contract.ts'
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
   * This deployment's own code, writing as `self`: `client(name)`, a watcher, the middleware's
   * client (`via: middleware`), or sync (`via: engine`). Each backend decides who that is on its
   * board: `vboard:client:<name>` on a2(), `<principal>+<name>` elsewhere.
   */
  | { self: string; origin: WriteOrigin }

/** One method per protocol route: the caller, the parsed input, and the request's signal. */
export type ProtocolMethods = {
  [M in keyof Protocol]: (caller: Caller, input: Protocol[M]['input'], signal: AbortSignal) => Promise<Protocol[M]['output']>
}

/** A route of a backend's own, beside the protocol: a2()'s stuck list, http()'s wake-ups. */
export type BackendRoute = {
  method: 'GET' | 'POST'
  /** Under the board's mount, with `:param` segments, e.g. `/stuck` or `/wake`. */
  path: string
  /** Whether board() verifies the caller first. A wake-up carries no board token. */
  auth: boolean
  handle(request: Request, context: { caller: Caller | null; param: string | null }): Promise<Response>
}

/** The subscription sync's outbound runs on, in `BoardBinding.subscriptions`. No watcher's ID starts with `@`. */
export const SYNC = '@sync'

/** What runs on a board's events. */
export type Subscription =
  /** A watcher: every event its tail prints. */
  | { kind: 'tail'; tail: string; when: 'matches' | 'enters' }
  /** Sync's outbound: every post, change, and thread sync in every channel, as its own code sees them. */
  | { kind: 'sync' }

/** A platform event sync pushed to an inbox, as the backend delivers it back. */
export type InboxDelivery = { event: ExternalEvent; raw: unknown }

/** What a backend gets from the board it serves: once, in memory, when board() is created. */
export type BoardBinding = {
  /** What runs on this board's events, by ID: this project's watchers, and sync's outbound at `SYNC` when it syncs. */
  subscriptions: Record<string, Subscription>
  /**
   * Runs one subscription on an event. A throw is the backend's to retry; `attempt` counts tries
   * from 1, and sync gives up on a delivery, and says so, before A2 would dead-letter it.
   */
  run(id: string, event: WatcherContext['event'], meta: { trigger: string; attempt: number }): Promise<void>
  /**
   * Runs one platform event this board's sync pushed to the backend's inbox, for a backend that
   * delivers them in-process: one platform thread at a time, in order. `id` is the event's in the
   * inbox, which the writes it makes derive their IDs from. A throw is the backend's to retry.
   */
  receive(key: string, item: InboxDelivery, meta: { id: string; attempt: number; signal: AbortSignal }): Promise<void>
  /** Pulls and runs what this board's sync queued in a backend's inbox, for one that queues them: http()'s, when it's woken. */
  pull(): Promise<number>
  /**
   * What a stored principal (a schedule's creator, a watcher's registrant) may do now, under the
   * board's rules as they are: null once it may do nothing. Background work checks with it.
   */
  accessFor(principal: Pick<Principal, 'id' | 'kind' | 'facts' | 'scope'>): Promise<Access | null>
  /**
   * An in-process client through the board, as `caller`: every write goes through what a request's
   * does, the middleware included. Its posts get IDs derived from `trigger`.
   */
  client(caller: Caller, trigger: string | null): BoardClient
  /** The board's own URL, where a board elsewhere can wake it, once it's known. */
  url(): string | null
}

/**
 * Where a board lives. board() serves the protocol over HTTP: it routes, validates, verifies
 * tokens, applies the access rules, runs the middleware and sync, and calls these. A backend
 * stores and answers.
 */
export interface Backend extends ProtocolMethods {
  /** Set when this backend keeps nothing here: discovery sends clients to that board instead. */
  readonly remote: string | null
  /** Routes of its own, beside the protocol. */
  readonly routes: readonly BackendRoute[]
  /**
   * board() calls it once, when it's created, before any request: what background work needs
   * from the board (its rules, its subscriptions, an in-process client). It does no I/O.
   */
  bind(board: BoardBinding): void
}
