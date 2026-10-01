import { useSyncExternalStore } from 'react'
import type { BoardEventView, InboxEntry } from '../../api/routes.ts'
import { createBoardClient } from '../../client/client.ts'
import * as store from './store.ts'

// The page's connection to the board: the same SDK as every other client,
// pointed at the inspector, which adds your credentials.

const token = document.querySelector<HTMLMetaElement>('meta[name="inspect-token"]')?.content ?? ''

let state = store.initialState
const listeners = new Set<() => void>()

function set(next: (state: store.State) => store.State) {
  const updated = next(state)
  if (updated === state) return
  state = updated
  for (const listener of listeners) listener()
}

export function useBoard(): store.State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

export const getState = () => state

// --- who you post as: the CLI's identity, or a profile picked here ----------------------

const PROFILE_KEY = 'just-board.profile'

/** `undefined`: as `jb inspect` started. `null`: yourself. A string: that profile. */
let profile: string | null | undefined = (() => {
  try {
    const stored = localStorage.getItem(PROFILE_KEY)
    return stored === null ? undefined : (JSON.parse(stored) as string | null)
  } catch {
    return undefined
  }
})()

export const getProfile = () => profile

const client = createBoardClient({
  url: `${location.origin}/board`,
  token: '',
  headers: () => ({ 'x-inspect-token': token, ...(profile !== undefined ? { 'x-inspect-profile': profile ?? '' } : {}) }),
  fetch: async (input, init) => {
    const stream = String(input).includes('/board/events')
    try {
      const response = await fetch(input, init)
      if (stream) set((s) => ({ ...s, live: response.ok ? 'live' : 'reconnecting' }))
      return response
    } catch (error) {
      if (stream && !init?.signal?.aborted) set((s) => ({ ...s, live: 'reconnecting' }))
      throw error
    }
  },
})

/** Switches who you post as, then learns the identity that is. */
export async function setProfile(next: string | null | undefined) {
  const previous = profile
  profile = next
  try {
    if (next === undefined) localStorage.removeItem(PROFILE_KEY)
    else localStorage.setItem(PROFILE_KEY, JSON.stringify(next))
  } catch {}
  try {
    const me = await client.me()
    set((s) => ({ ...s, me }))
  } catch (error) {
    profile = previous
    toast(`couldn't switch: ${message(error)}`)
  }
}

// --- which message you're editing ---------------------------------------------------

let editing: number | null = null
const editingListeners = new Set<() => void>()

export function setEditing(id: number | null) {
  editing = id
  editingListeners.forEach((listener) => listener())
}

export function useEditing(): number | null {
  return useSyncExternalStore(
    (listener) => {
      editingListeners.add(listener)
      return () => editingListeners.delete(listener)
    },
    () => editing,
  )
}

// --- errors ------------------------------------------------------------------

export type Toast = { id: number; text: string }
let toasts: Toast[] = []
const toastListeners = new Set<() => void>()
let toastId = 0

export function toast(text: string) {
  const id = ++toastId
  toasts = [...toasts, { id, text }]
  toastListeners.forEach((listener) => listener())
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    toastListeners.forEach((listener) => listener())
  }, 6000)
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => {
      toastListeners.add(listener)
      return () => toastListeners.delete(listener)
    },
    () => toasts,
  )
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// --- loading -------------------------------------------------------------------

const loaded = new Map<string, Promise<void>>()

/** Loads once per key; a failure can be retried. */
function once(key: string, load: () => Promise<void>): Promise<void> {
  let promise = loaded.get(key)
  if (!promise) {
    promise = load().catch((error) => {
      loaded.delete(key)
      toast(message(error))
    })
    loaded.set(key, promise)
  }
  return promise
}

export async function boot() {
  const [me, discovery, channels, recent] = await Promise.all([
    client.me(),
    client.discovery().catch(() => null),
    client.channels(),
    client.messages({ limit: 200 }),
  ])
  set((s) =>
    store.merge(
      { ...s, me, discovery, channels: Object.fromEntries(channels.map((c) => [c.path, c])), cursor: recent.cursor },
      recent.messages,
      recent.cursor,
    ),
  )
  void stream(recent.cursor)
}

/** Folds the live stream in, a frame's worth of events at a time. */
async function stream(after: number) {
  let queue: BoardEventView[] = []
  let scheduled = false
  const flush = () => {
    scheduled = false
    const events = queue
    queue = []
    set((s) => events.reduce(store.applyEvent, s))
  }
  try {
    for await (const event of client.events({ all: true, after })) {
      queue.push(event)
      if (!scheduled) {
        scheduled = true
        requestAnimationFrame(flush)
      }
    }
  } catch (error) {
    // The SDK retries dropped connections itself; this is the board refusing the stream.
    set((s) => ({ ...s, live: 'reconnecting' }))
    toast(`live updates stopped: ${message(error)}`)
  }
}

const PAGE = 200

/** Whether older messages exist past what's loaded, per channel. */
const exhausted = new Set<string>()

export const loadChannel = (channel: string) =>
  once(`channel:${channel}`, async () => {
    const page = await client.messages({ channel, limit: PAGE })
    if (page.messages.length < PAGE) exhausted.add(channel)
    set((s) => store.merge(s, page.messages, page.cursor))
  })

export async function loadOlder(channel: string): Promise<boolean> {
  const oldest = Object.values(state.messages)
    .filter((m) => m.channel === channel)
    .reduce((min, m) => Math.min(min, m.id), Number.POSITIVE_INFINITY)
  if (exhausted.has(channel) || !Number.isFinite(oldest)) return false
  try {
    const page = await client.messages({ channel, before: oldest, limit: PAGE })
    if (page.messages.length < PAGE) exhausted.add(channel)
    set((s) => store.merge(s, page.messages, page.cursor))
    return !exhausted.has(channel)
  } catch (error) {
    toast(message(error))
    return true
  }
}

export const hasOlder = (channel: string) => !exhausted.has(channel)

export const loadThread = (id: number) =>
  once(`thread:${id}`, async () => {
    const { message: root, replies, cursor } = await client.thread(id)
    set((s) => store.merge(s, [root, ...replies], cursor))
  })

export const loadInbox = (key: string): Promise<InboxEntry[]> => client.inbox(key, { limit: 100 })

// --- writes --------------------------------------------------------------------

/** Shows a post at once; the board's answer replaces it. */
export async function send(
  post: { channel: string; re: number | null; text: string; noSync: boolean; labels: Record<string, string> },
  key: string = crypto.randomUUID(),
) {
  const pending: store.Pending = { ...post, key, createdAt: new Date().toISOString(), error: null }
  set((s) => ({ ...s, pending: [...s.pending.filter((p) => p.key !== key), pending] }))
  try {
    const options = {
      text: post.text,
      id: key,
      ...(post.noSync ? { noSync: true } : {}),
      ...(Object.keys(post.labels).length > 0 ? { labels: post.labels } : {}),
    }
    const sent = post.re === null ? await client.post(post.channel, options) : await client.reply(post.re, options)
    set((s) => store.merge({ ...s, pending: s.pending.filter((p) => p.key !== key) }, [sent], sent.id))
  } catch (error) {
    set((s) => ({ ...s, pending: s.pending.map((p) => (p.key === key ? { ...p, error: message(error) } : p)) }))
  }
}

export const retry = (pending: store.Pending) => send(pending, pending.key)
export const discard = (key: string) => set((s) => ({ ...s, pending: s.pending.filter((p) => p.key !== key) }))

/**
 * Applies a change at once and sends it. The board's next view of the message
 * confirms it; if that never comes, the overlay drops after a while and the
 * board's view stands.
 */
async function change(id: number, op: store.Op, run: () => Promise<unknown>) {
  const opId = crypto.randomUUID()
  set((s) => store.addOp(s, id, opId, op))
  try {
    await run()
    setTimeout(() => set((s) => store.dropOp(s, id, opId)), 8000)
  } catch (error) {
    set((s) => store.dropOp(s, id, opId))
    toast(message(error))
  }
}

export const react = (id: number, emoji: string, remove: boolean) =>
  change(id, { kind: 'react', emoji, remove }, () => client.react(id, emoji, { remove }))

export const edit = (id: number, text: string) => change(id, { kind: 'edit', text }, () => client.edit(id, text))

export const remove = (id: number) => change(id, { kind: 'delete' }, () => client.delete(id))

export const label = (id: number, put: Record<string, string>, unset: string[]) =>
  change(id, { kind: 'label', set: put, unset }, () => client.label(id, { set: put, unset }))
