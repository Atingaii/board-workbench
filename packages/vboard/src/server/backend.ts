import type { Protocol } from '../api/protocol.ts'
import type { MessageView, SourceRead } from '../api/routes.ts'
import type { ProfileOption } from '../client/client.ts'
import type { ExternalEvent } from '../contract/contract.ts'
import type { Board } from './board.ts'
import type { WatcherContext } from './watch.ts'
import type { WriteOrigin } from './writes.ts'

/**
 * What a request says about who's calling, beside its credential: labels the caller picks for
 * itself, under whoever the credential turns out to be. They're never security: a backend that
 * verifies the credential uses them to work out the actor it writes as.
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

/** A request, as board() hands it to a backend: what it said, none of it verified. */
export type CallerRequest = {
  /** The bearer token, or null when it sent none. */
  credential: string | null
  claims: Claims
  /** The board's URL, which a token must be minted for. */
  audience: string
  /** Its headers, for a backend that recognizes a session of its own: a same-site page's cookie, say. */
  headers: Headers
}

/** This deployment's own code, as it calls the backend through board(). */
export type SelfCaller = {
  /**
   * A handle (`via: client`, with the profile from `as(profile)`, or null for the board's own), a
   * watcher, the middleware's handle (`via: middleware`), or sync (`via: engine`). Each backend
   * decides who that is on its board: `vboard:client` and `vboard:client:<profile>` on a2(), the
   * token's holder with that profile elsewhere.
   */
  self: string | null
  /**
   * What `as(profile)` asked for, its avatar included, or null for yourself. Absent on the
   * handle itself, whose caller is whoever the environment picks: a backend elsewhere sends
   * the profile `VBOARD_AS` or the agent it runs in names.
   */
  profile?: ProfileOption
  origin: WriteOrigin
}

/** Who's calling a backend's method. Every method verifies what it needs and honors what the caller may do. */
export type Caller =
  /** A request: what it said about itself, unverified. The backend verifies its credential for `audience`. */
  | { request: CallerRequest; origin: WriteOrigin }
  | SelfCaller

/** One method per protocol route: the caller, the parsed input, and the request's signal. */
export type ProtocolMethods = {
  [M in keyof Protocol]: (caller: Caller, input: Protocol[M]['input'], signal: AbortSignal) => Promise<Protocol[M]['output']>
}

/** A route of a backend's own, beside the protocol: http()'s wake-ups. */
export type BackendRoute = {
  method: 'GET' | 'POST'
  /** Under the board's mount, with `:param` segments, e.g. `/wake`. One at a protocol route's path takes its place. */
  path: string
  /** `caller` is the request's, unverified, or this deployment's own code: the route verifies what it needs. */
  handle(request: Request, context: { caller: Caller; param: string | null }): Promise<Response>
}

/** The subscription sync's outbound runs on, in `BoardBinding.subscriptions`. No watcher's ID starts with `@`. */
export const SYNC = '@sync'

/** What runs on a board's events. */
export type Subscription =
  /** A watcher: every event its tail prints. */
  | { kind: 'tail'; tail: string; when: 'matches' | 'enters' }
  /** Sync's outbound: every post, change, and thread sync in every channel, as its own code sees them. */
  | { kind: 'sync' }

/** One of board()'s sync entries: its key, its platform, and whether it can sign people in. */
export type SyncEntry = { key: string; platform: string; signIn: boolean }

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
  /** board()'s sync entries: what its sync imports through, and what discovery lists. */
  sync: readonly SyncEntry[]
  /**
   * Reads a platform channel or thread with sync entry `key`'s app, which only board() has: what
   * `readSource` answers. 404 `not_synced_here` for an entry it doesn't run.
   */
  readSource(key: string, target: string, limit: number): Promise<SourceRead>
  /**
   * Shows typing in the platform threads a board thread (`messages`, its root first) is synced to,
   * through board()'s sync: what `typing` answers. Answers the threads that took it.
   */
  typing(messages: readonly MessageView[], status: string | undefined): Promise<string[]>
  /** A handle through board(), as `caller`: the middleware's, say. */
  handle(caller: SelfCaller): Board
  /** The board's own URL, where a board elsewhere can wake it, once it's known. */
  url(): string | null
}

/**
 * Where a board lives. board() serves the protocol over HTTP: it routes, validates, serves, runs
 * watchers and sync, and calls these with what each request said. A backend verifies, decides,
 * stores, and answers.
 */
export interface Backend extends ProtocolMethods {
  /** Routes of its own, beside the protocol: one at a protocol route's path takes its place. */
  readonly routes: readonly BackendRoute[]
  /**
   * board() calls it once, when it's created, before any request: what background work needs
   * from the board (its subscriptions, its sync, a handle through it). It does no I/O.
   */
  bind(board: BoardBinding): void
}
