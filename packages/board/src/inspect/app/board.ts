import { useSyncExternalStore } from 'react'
import type { BoardEventView, Explanation, GrantInput, InboxEntry, Me, SchemaInput, SyncedView } from '../../api/routes.ts'
// `@vercel/board/access`, in an app of yours.
import { compileAccess } from '../../server/access.ts'
import { board, type Attachment, type EventsState, type ExplainPrincipal, type PostOptions, type ScheduleTiming } from '../../server/index.default.ts'
// The one import an app of yours can't make, and doesn't need. There, this file starts with
// `const team = board()` in server code (a route handler, a server action), which finds the team's
// board and your credentials itself. This page's server is the CLI on your machine, which keeps
// your credentials behind a proxy at /board, and `http()` is how a handle in the page reaches it.
// Everything under that line reads as it would in your app: plain `team.*` calls.
import { http } from '../../backend-http/index.default.ts'
import { toast } from './chrome.ts'
import * as store from './store.ts'
import { said } from './words.ts'

// The page's data: one handle on the board, and every read and write the page makes through it.

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? ''

/** A profile you post as: its name, and the avatar you gave it (an https URL), if any. */
export type Profile = { name: string; avatar?: string }

/** You, as no profile. Its `fetch` sends the page's credential for the proxy: a token only this run's page has. */
const yourself = board({
  backend: http(`${location.origin}/board`, {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers)
      headers.set('x-inspect-token', meta('inspect-token'))
      return fetch(input, { ...init, headers })
    },
  }),
})

// --- who you post as: `team.as(profile)` ------------------------------------------------

const PROFILE_KEY = 'board.profile'
const AVATARS_KEY = 'board.avatars'

const stored = <T>(key: string): T | undefined => {
  try {
    const value = localStorage.getItem(key)
    return value === null ? undefined : (JSON.parse(value) as T)
  } catch {
    return undefined
  }
}

/** The profile `vb inspect` started as (`--as claude`), which the page is told beside its token. */
const started: Profile | null = (() => {
  try {
    return JSON.parse(meta('inspect-profile') || 'null') as Profile | null
  } catch {
    return null
  }
})()

/** `undefined`: as inspect started. `null`: yourself. Else that profile (stored by its name alone, before avatars). */
let profile: Profile | null | undefined = (() => {
  const value = stored<string | Profile | null>(PROFILE_KEY)
  return typeof value === 'string' ? { name: value } : value
})()

/** The avatar you last gave each profile, so picking it again brings it back. */
const avatars: Record<string, string> = stored<Record<string, string>>(AVATARS_KEY) ?? {}

export const getProfile = () => profile
export const avatarOf = (name: string): string | undefined => avatars[name]

const handleFor = (choice: Profile | null | undefined) => {
  const as = choice === undefined ? started : choice
  return as === null ? yourself : yourself.as(as)
}

/** The handle every call below goes through: you, or you as the profile you picked. */
let team = handleFor(profile)

/** Switches who you post as, then learns the identity that is, and remembers it once the board takes it. */
export async function setProfile(next: Profile | null | undefined) {
  const handle = handleFor(next)
  try {
    const me = await handle.me()
    team = handle
    profile = next
    set((s) => ({ ...s, me }))
  } catch (error) {
    toast(`couldn't switch: ${said(error)}`)
    return
  }
  if (next) {
    if (next.avatar) avatars[next.name] = next.avatar
    else delete avatars[next.name]
  }
  try {
    if (next === undefined) localStorage.removeItem(PROFILE_KEY)
    else localStorage.setItem(PROFILE_KEY, JSON.stringify(next))
    localStorage.setItem(AVATARS_KEY, JSON.stringify(avatars))
  } catch {}
}

/** What you may do where: `me.can` is each channel pattern's permissions, and `compileAccess` answers for a channel. */
export function viewerOf(me: Me): store.Viewer {
  const access = compileAccess(me.can)
  return { actor: me.actor, principal: me.principal, may: (permission, channel) => access.can(permission, channel), manages: access.at('manage', '*') }
}

// --- the page's state: what the board said, folded by store.ts --------------------------------

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

const loaded = new Map<string, Promise<void>>()

/** Loads once per key; a failure can be retried. */
function once(key: string, load: () => Promise<void>): Promise<void> {
  let promise = loaded.get(key)
  if (!promise) {
    promise = load().catch((error) => {
      loaded.delete(key)
      toast(said(error))
    })
    loaded.set(key, promise)
  }
  return promise
}

// --- reading -----------------------------------------------------------------------

/**
 * The page shows once it knows who you are and the channels; the latest across them, the slowest
 * read on a big board, fills the activity view when it lands, and the feed goes on from its cursor.
 */
export async function boot() {
  const recent = team.messages({ limit: 200 })
  // Awaited after the rest: a failure then is the boot's, not an unhandled one.
  recent.catch(() => {})
  const [me, discovery, channels] = await Promise.all([team.me(), team.discovery().catch(() => null), team.channels()])
  set((s) => ({ ...s, me, discovery, channels: Object.fromEntries(channels.map((c) => [c.path, c])) }))
  const page = await recent
  set((s) => store.merge({ ...s, cursor: page.cursor }, page.messages))
  // A burst of events is one render: they're folded in a frame at a time.
  let queue: BoardEventView[] = []
  const flush = () => {
    const events = queue
    queue = []
    set((s) => events.reduce(store.applyEvent, s))
    // A schedule's own state isn't in the feed, but its sends are: one that landed means the list moved.
    if (events.some((event) => event.message?.schedule !== undefined)) void loadSchedules()
  }
  follow(
    page.cursor,
    (event) => {
      if (queue.push(event) === 1) requestAnimationFrame(flush)
    },
    (feed) => set((s) => ({ ...s, live: feed === 'live' ? 'live' : 'reconnecting' })),
  ).catch((error) => toast(`live updates stopped: ${said(error)}`))
  // Who's who, for the names beside IDs: who made a grant, who registered a schema.
  void team.actors().then((actors) => set((s) => ({ ...s, actors: { ...Object.fromEntries(actors.map((actor) => [actor.id, actor])), ...s.actors } })), () => {})
  void loadSchemas()
  void loadSchedules()
}

// #region guide inspector/live.ts
/**
 * Follows the board's feed from `after`: every event since, as it happens. `onState` hears whether
 * it's connected, `live` or `retrying`, each time that changes. The handle retries a dropped
 * connection itself; this throws only when the board refuses the feed (a token that ran out, say).
 */
async function follow(after: string, each: (event: BoardEventView) => void, onState: (state: EventsState) => void) {
  for await (const event of team.events({ all: true, after }, { onState })) each(event)
}
// #endregion

// #region guide inspector/read.ts
const PAGE = 200

/** A channel's newest messages, roots and replies alike; with `before`, the ones older than that message, to page back. */
const readChannel = (channel: string, before?: string) => team.messages({ channel, limit: PAGE, ...(before ? { before } : {}) })

/** A thread: its root, its replies oldest first, and the cursor to follow it from. */
const readThread = (id: string) => team.thread(id)
// #endregion

/** Whether older messages exist past what's loaded, per channel. */
const exhausted = new Set<string>()

export const loadChannel = (channel: string) =>
  once(`channel:${channel}`, async () => {
    const page = await readChannel(channel)
    if (page.messages.length < PAGE) exhausted.add(channel)
    set((s) => store.merge(s, page.messages))
  })

export async function loadOlder(channel: string): Promise<boolean> {
  const oldest = Object.values(state.messages)
    .filter((m) => m.channel === channel)
    .sort(store.byWritten)[0]
  if (exhausted.has(channel) || !oldest) return false
  try {
    const page = await readChannel(channel, oldest.id)
    if (page.messages.length < PAGE) exhausted.add(channel)
    set((s) => store.merge(s, page.messages))
    return !exhausted.has(channel)
  } catch (error) {
    toast(said(error))
    return true
  }
}

export const loadThread = (id: string) =>
  once(`thread:${id}`, async () => {
    const { message: root, replies } = await readThread(id)
    set((s) => store.merge(s, [root, ...replies]))
  })

export const loadInbox = (key: string): Promise<InboxEntry[]> => team.inbox(key, { limit: 100 })

/**
 * History that matches a view's filters, from the board, so a filter finds
 * older messages too; the feed keeps it current. Replies come with their
 * thread's root, which the page needs to show them and to match its labels.
 */
export const loadFiltered = (channel: string | undefined, filter: store.Filter) =>
  once(`filtered:${channel ?? '*'}:${JSON.stringify(filter)}`, async () => {
    const page = await team.messages({
      ...(channel ? { channel } : {}),
      ...(filter.from ? { from: filter.from } : {}),
      ...(filter.text ? { text: filter.text } : {}),
      ...(filter.label.length > 0 ? { label: filter.label } : {}),
      limit: PAGE,
    })
    set((s) => store.merge(s, page.messages))
    const missing = [...new Set(page.messages.flatMap((m) => (m.re !== null && !state.messages[m.re] ? [m.re] : [])))].slice(0, 30)
    await Promise.all(missing.map((id) => loadThread(id)))
  })

// --- writing -----------------------------------------------------------------------

// #region guide inspector/write.ts
/**
 * Posts a thread, or a reply in one. `id` is yours for this post: the same `id` never posts twice,
 * so sending it again after a dropped connection is safe.
 */
const write = (to: { channel: string } | { re: string }, message: PostOptions & { id: string }) => ('re' in to ? team.reply(to.re, message) : team.post(to.channel, message))

/** A reaction, by its short name (`eyes`), `:eyes:`, or the character; `remove` takes yours back. */
const setReaction = (id: string, emoji: string, remove: boolean) => team.react(id, emoji, { remove })

/** Sets and unsets labels on a message. */
const setLabels = (id: string, set: Record<string, string>, unset: string[]) => team.label(id, { set, unset })
// #endregion

/** A post's files, kept until it lands so a retry can send them again. */
const outgoing = new Map<string, File[]>()

/**
 * Shows a post at once; the board's answer replaces it. Files upload first. One to send later is
 * kept the same way until the board has its schedule: a refusal stays as the post with why, and
 * retry schedules it again, so nothing typed is lost.
 */
export async function send(
  post: { channel: string; re: string | null; text: string; noSync: boolean; labels: Record<string, string>; files?: File[]; later?: ScheduleTiming },
  key: string = crypto.randomUUID(),
) {
  const files = post.files ?? outgoing.get(key) ?? []
  outgoing.set(key, files)
  const pending: store.Pending = {
    channel: post.channel,
    re: post.re,
    text: post.text,
    noSync: post.noSync,
    labels: post.labels,
    ...(files.length ? { files: files.map((f) => ({ name: f.name, size: f.size })) } : {}),
    ...(post.later ? { later: post.later } : {}),
    key,
    createdAt: new Date().toISOString(),
    error: null,
  }
  set((s) => ({ ...s, pending: [...s.pending.filter((p) => p.key !== key), pending] }))
  try {
    const attachments = await Promise.all(files.map((file) => team.upload({ data: file, name: file.name })))
    const content = {
      text: post.text,
      ...(attachments.length ? { attachments } : {}),
      ...(post.noSync ? { noSync: true } : {}),
      ...(Object.keys(post.labels).length > 0 ? { labels: post.labels } : {}),
    }
    if (post.later) {
      // Posts later, as you: a new thread in a channel, or a reply in a thread. Its files go with every send.
      const scheduled = await team.schedule(post.re === null ? post.channel : { re: post.re }, { ...content, ...post.later })
      outgoing.delete(key)
      set((s) => ({ ...s, pending: s.pending.filter((p) => p.key !== key) }))
      toast(`scheduled for ${new Date(scheduled.next ?? scheduled.first).toLocaleString()}`)
      void loadSchedules()
      return
    }
    // The same `id` never posts twice, so a retry is safe.
    const options = { ...content, id: key }
    const sent = await write(post.re === null ? { channel: post.channel } : { re: post.re }, options)
    outgoing.delete(key)
    set((s) => store.merge({ ...s, pending: s.pending.filter((p) => p.key !== key) }, [sent]))
  } catch (error) {
    set((s) => ({ ...s, pending: s.pending.map((p) => (p.key === key ? { ...p, error: said(error) } : p)) }))
  }
}

export const retry = ({ files: _shown, ...pending }: store.Pending) => send(pending, pending.key)

export const discard = (key: string) => {
  outgoing.delete(key)
  set((s) => ({ ...s, pending: s.pending.filter((p) => p.key !== key) }))
}

/**
 * Applies a change at once and sends it. The board's next view of the message
 * confirms it; if that never comes, the overlay drops after a while and the
 * board's view stands.
 */
async function change(id: string, op: store.Op, run: () => Promise<unknown>) {
  const opId = crypto.randomUUID()
  set((s) => store.addOp(s, id, opId, op))
  try {
    await run()
    setTimeout(() => set((s) => store.dropOp(s, id, opId)), 8000)
  } catch (error) {
    set((s) => store.dropOp(s, id, opId))
    toast(said(error))
  }
}

export const react = (id: string, emoji: string, remove: boolean) => change(id, { kind: 'react', emoji, remove }, () => setReaction(id, emoji, remove))

export const edit = (id: string, text: string) => change(id, { kind: 'edit', text }, () => team.edit(id, text))

export const remove = (id: string) => change(id, { kind: 'delete' }, () => team.delete(id))

export const label = (id: string, put: Record<string, string>, unset: string[]) =>
  change(id, { kind: 'label', set: put, unset }, () => setLabels(id, put, unset))

// --- attachments -----------------------------------------------------------------

const objectUrls = new Map<string, Promise<string>>()

/** An attachment as a `blob:` URL. The page fetches it through its handle: an `<img>` can't send the page's token. */
export function attachmentUrl(id: string): Promise<string> {
  let url = objectUrls.get(id)
  if (!url) {
    url = team.download(id).then(async (response) => URL.createObjectURL(await response.blob()))
    url.catch(() => objectUrls.delete(id))
    objectUrls.set(id, url)
  }
  return url
}

/** Saves an attachment under its own name. */
export async function saveAttachment(attachment: Attachment) {
  try {
    const link = document.createElement('a')
    link.href = await attachmentUrl(attachment.id)
    link.download = attachment.name
    link.click()
  } catch (error) {
    toast(`couldn't download ${attachment.name}: ${said(error)}`)
  }
}

// --- schemas: what a message's blocks hold -------------------------------------------------

/** The board's registry: the built-ins, then its own. It says what each block's fields mean. */
export async function loadSchemas() {
  try {
    const schemas = await team.schemas()
    set((s) => ({ ...s, schemas, schemasRefused: null }))
  } catch (error) {
    // Blocks still show, by their data alone; the registry's view says what the board answered.
    set((s) => ({ ...s, schemasRefused: said(error) }))
  }
}

/** Reads the registry again for a schema it doesn't hold: someone may have registered it since, and nothing in the feed says so. Once per schema. */
export const findSchema = (id: string) => once(`schema:${id}`, loadSchemas)

/** Registers a schema version, for good. Answers what the board refused it for, in its words, or null once it's kept. */
export async function registerSchema(input: SchemaInput): Promise<string | null> {
  try {
    const { schema } = await team.createSchema(input)
    set((s) => store.addSchema(s, schema))
    return null
  } catch (error) {
    return said(error)
  }
}

// --- access: who is let in, and what each may do ---------------------------------------------

/** The board's grants. Listing them needs `manage` at `*`: for anyone else the board says so, and the page shows that. */
export async function loadGrants() {
  set((s) => (s.grants.is === 'here' ? s : { ...s, grants: { is: 'loading' } }))
  try {
    const grants = await team.grants()
    set((s) => ({ ...s, grants: { is: 'here', items: grants } }))
  } catch (error) {
    set((s) => ({ ...s, grants: { is: 'failed', why: said(error) } }))
  }
}

/** A new grant. Answers what the board refused it for, in its words, or null once it's made. */
export async function createGrant(input: GrantInput): Promise<string | null> {
  try {
    await team.createGrant(input)
    await loadGrants()
    return null
  } catch (error) {
    return said(error)
  }
}

/** Revokes a grant: its principals' next requests are refused. */
export async function revokeGrant(id: string) {
  try {
    await team.revokeGrant(id)
  } catch (error) {
    toast(`couldn't revoke ${id}: ${said(error)}`)
  }
  await loadGrants()
}

/** Which grants decide a channel, and what they give: the board's own answer, for you or for the principal `whom` names. */
export const explain = (channel: string, whom: ExplainPrincipal = {}): Promise<Explanation> => team.explain(channel, whom)

// --- schedules: messages that post later --------------------------------------------------------

/** What's scheduled: pending ones, or with `all`, done and canceled ones too. */
export async function loadSchedules(all = state.everySchedule) {
  set((s) => ({ ...s, everySchedule: all, schedules: s.schedules.is === 'here' ? s.schedules : { is: 'loading' } }))
  try {
    const schedules = await team.schedules({ all })
    set((s) => ({ ...s, schedules: { is: 'here', items: schedules } }))
  } catch (error) {
    set((s) => ({ ...s, schedules: { is: 'failed', why: said(error) } }))
  }
}

/** Stops a schedule: yours, or any where you have `manage`. */
export async function cancelSchedule(id: string) {
  try {
    await team.cancelSchedule(id)
  } catch (error) {
    toast(`couldn't cancel ${id}: ${said(error)}`)
  }
  await loadSchedules()
}

// --- watchers, sync, and channels ------------------------------------------------------------

/** The watchers boards elsewhere registered here, and what each tails: all of them with `manage` everywhere, or else your own. */
export async function loadWatchers() {
  set((s) => (s.watchers.is === 'here' ? s : { ...s, watchers: { is: 'loading' } }))
  try {
    const watchers = await team.watchers()
    set((s) => ({ ...s, watchers: { is: 'here', items: watchers } }))
  } catch (error) {
    set((s) => ({ ...s, watchers: { is: 'failed', why: said(error) } }))
  }
}

/** Where a thread is synced: each target, and the platform's link to its copy there. Nothing, on a board that syncs nothing. */
export async function loadSynced(id: string): Promise<SyncedView['targets']> {
  if ((state.discovery?.sync ?? []).length === 0) return []
  try {
    return (await team.sync(id)).targets
  } catch {
    return []
  }
}

/** Makes a channel before anything posts to it; `private` closes it to everyone but you, with two grants. Answers whether it's there to open. */
export async function createChannel(path: string, options: { private?: boolean } = {}): Promise<boolean> {
  try {
    const { channel, created } = await team.createChannel(path, options)
    set((s) => (s.channels[channel.path] ? s : { ...s, channels: { ...s.channels, [channel.path]: channel } }))
    if (!created) toast(`#${path} is there already`)
    return true
  } catch (error) {
    toast(`couldn't make #${path}: ${said(error)}`)
    return false
  }
}
