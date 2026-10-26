import type { BoardClient } from '../client/client.ts'
import type { BoardEventView, MessageView } from '../api/routes.ts'
import type { ProviderEvent, SyncOverrides, SyncResult } from './events.ts'
import type { Renderer } from './provider.ts'

/** An event coming in from the platform. */
export type SyncIn<E extends ProviderEvent = ProviderEvent> = {
  direction: 'in'
  /** The sync entry's key: `slack` in `sync: { slack: slack(…) }`. */
  key: string
  /** The platform channel it happened in, as the platform names it: `C0123ABC`, `owner/repo:pulls`, a phone number ID. */
  channel: string
  /** The event, validated and frozen. */
  event: E
  /** The board, as the platform user the event came from: its writes are theirs. */
  board: BoardClient
  /**
   * Imports the event: into its board thread when the board syncs its platform thread, otherwise
   * as a new root in `channel`. Without a channel, an event in a thread the board doesn't sync
   * stays off it. Runs once: a second call answers what the first did.
   */
  import(channel?: string, overrides?: SyncOverrides): Promise<SyncResult>
  /** The platform's own link to the event's message, or null when it has none. Nothing is synced or joined. */
  permalink(): Promise<string | null>
  /** A platform channel's ID from its name (`#dev` → `C0123ABC`), as `channel` names it. */
  resolve(name: string): Promise<string>
}

/** A board event going out to the platform. */
export type SyncOut = {
  direction: 'out'
  key: string
  /** The platform channel `target` is in, as the platform names it; null for a new root, which isn't on the platform yet. */
  channel: string | null
  event: BoardEventView
  /** The message the event is about, as it is now. */
  message: MessageView
  /** Where it goes: a platform thread or channel the board thread syncs with (`slack:C0123ABC:1727000000.123456`), or null for a new root. */
  target: string | null
  /**
   * Sends the event to `target`: a new thread's root and what's been said in it, a reply, an
   * edit, a delete, a reaction, or the copy a label change re-renders. A new root has no target
   * yet, so it sends nothing. Runs once: a second call answers what the first did.
   */
  deliver(options?: { render?: Renderer }): Promise<void>
  /**
   * Syncs the message's thread with a platform channel (`#dev`, `C0123ABC`): the board starts a
   * thread there, and its root and replies follow. Never the channel it came from.
   */
  start(channel: string): Promise<void>
  resolve(name: string): Promise<string>
}

export type Sync<E extends ProviderEvent = ProviderEvent> = SyncIn<E> | SyncOut

/**
 * What every event does, both ways. Inbound, it calls `import` to bring the event onto the board;
 * outbound, `deliver` to send it to the platform, or `start` to open a new root's thread there.
 * One that calls neither does nothing. A throw is retried.
 *
 * `hears` says which platform channels it cares about, so the webhook keeps only their events
 * (and those of threads the board syncs) in the inbox. Without it, every event the platform
 * sends is kept. `channels`, `repos`, and `numbers` set it; `render` passes it on.
 */
export type SyncFn<E extends ProviderEvent = ProviderEvent> = ((sync: Sync<E>) => unknown) & {
  hears?: (channel: string, resolve: (name: string) => Promise<string>) => Promise<boolean>
}

/** A sync function, or a board channel: what a string means is up to the helper that takes it. */
export type SyncUnit<E extends ProviderEvent = ProviderEvent> = string | SyncFn<E>

/**
 * A two-way mirror of a board channel: what comes in lands in `channel`, what's said on the
 * board goes out, and a new root in `channel` starts a thread in the platform channel.
 */
export function mirror(channel: string): SyncFn {
  return async (sync) => {
    if (sync.direction === 'in') return void (await sync.import(channel))
    if (sync.target !== null) return sync.deliver()
    if (sync.channel !== null && sync.message.channel === channel) await sync.start(sync.channel)
  }
}

/** Imports into a board channel, and sends nothing back. */
export function into(channel: string): SyncFn {
  return async (sync) => {
    if (sync.direction === 'in') await sync.import(channel)
  }
}

/** `inner`, delivering with `renderer` unless it passes its own. */
export function render<E extends ProviderEvent = ProviderEvent>(renderer: Renderer, inner: SyncFn<E>): SyncFn<E> {
  const fn: SyncFn<E> = (sync) =>
    inner(sync.direction === 'in' ? sync : { ...sync, deliver: (options = {}) => sync.deliver({ render: renderer, ...options }) })
  if (inner.hears) fn.hears = inner.hears
  return fn
}

/** What a thread the board syncs does outside the mapped channels: it stays synced, both ways. */
const follow = async (sync: Sync) => {
  if (sync.direction === 'in') await sync.import()
  else await sync.deliver()
}

/**
 * Routes each event by its platform channel. Keys are platform channels, by name (`'#dev'`) or
 * ID (`'C0123ABC'`); values are a board channel to `mirror`, or a sync function. A new root goes
 * to every channel's function, with `channel` set to that one. A thread the board syncs outside
 * these channels (someone ran `vb sync` on it) stays synced both ways. A key that doesn't resolve
 * is skipped, and tried again a minute later.
 */
export function channels<E extends ProviderEvent = ProviderEvent>(map: Record<string, SyncUnit<E>>): SyncFn<E> {
  const units = Object.entries(map).map(([name, unit]) => [name, typeof unit === 'string' ? mirror(unit) : unit] as const)
  const resolved = async (resolve: (name: string) => Promise<string>) => {
    const ids = await Promise.allSettled(units.map(([name]) => resolve(name)))
    const found = new Map<string, SyncFn<E>>()
    ids.forEach((id, i) => {
      if (id.status === 'fulfilled') found.set(id.value, units[i]![1])
    })
    return found
  }
  const fn: SyncFn<E> = async (sync) => {
    const found = await resolved(sync.resolve)
    if (sync.direction === 'out' && sync.target === null) {
      for (const [channel, unit] of found) await unit({ ...sync, channel })
      return
    }
    const unit = found.get(sync.channel!)
    await (unit ? unit(sync) : follow(sync))
  }
  fn.hears = async (channel, resolve) => (await resolved(resolve)).has(channel)
  return fn
}
