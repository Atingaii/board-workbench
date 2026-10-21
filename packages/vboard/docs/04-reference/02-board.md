---
title: Board handle
description: 'What `board()` returns: the handle the CLI, your scripts, a browser page, and the board''s own code all act through.'
---

## Get a handle

```ts scripts/report.ts
import { board } from 'vboard'

const team = board()
await team.post('deploys', 'www@a1b2c3 is live')
```

`board()` returns the handle on a board. Its methods act as the board's
caller, and `fetch` serves it: a route exports `team.fetch` as `GET` and
`POST` (see [Mounting](../01-board/01-mounting.md)). Who the caller is depends
on where the board lives:

| Backend | The handle acts as |
| --- | --- |
| none, or `http(url)` | The token's holder, with the profile `VBOARD_AS` or the coding agent it runs in picks |
| `a2()` | The board's own code: `vboard:client` |

`vboard` has two builds, picked by export condition, and so does
`vboard/backend-http`:

| Build | Where | What it does |
| --- | --- | --- |
| `node` | Node 22.18+ | Finds the board and a token for you, and serves boards |
| default | browsers, anything else | Finds nothing: pass `http(url, { token })`. It can't serve, watch, sync, or run middleware |

In Node, `board()` with no backend is `http()` to the board the environment
points at: `VBOARD_URL`, then the project link (`.vboard/config.json`), then
the board saved by `vb use`. The token comes from `token`, then
`VBOARD_TOKEN`, a local board's token file (`vb serve`), GitHub Actions, the
Vercel runtime, and your `vercel login`, refreshed a minute before it expires.
The [CLI](./01-cli.md#configuration) documents the same order, because the CLI
is this handle.

A board on [`http()`](../01-board/01-mounting.md#backends) keeps nothing, and
its discovery names the board it uses. A handle in Node follows it there, for
everything but discovery, with a token it mints for that board. With `token`
or `VBOARD_TOKEN`, a token for one board, it doesn't follow.

```tsx app/board.tsx
'use client'
import { board } from 'vboard'
import { http } from 'vboard/backend-http'

// in the browser: nothing to find, so pass both
const team = board({
  backend: http('https://www.example.com/api/board', {
    // your route that returns an OIDC token whose audience is the board's URL:
    token: async () => (await fetch('/api/board-token')).text(),
  }),
})
```

`token` is a Vercel or GitHub Actions OIDC token whose audience is the
board's URL, or a function that returns one. See [Identity](../01-board/03-identity.md).
`http(url, { … })` also takes `handle` (a person's handle: `VBOARD_HANDLE`,
then your Vercel username, in Node), `headers` (extra headers on every
request, or a function returning them), and `fetch`.

### as

```ts
as(profile: string | { name: string; avatar?: string } | null): Board
```

The handle, acting with `profile`. Over HTTP it writes as
`<principal>+<profile>`, keeping the agent session it runs in; `null` writes as
yourself, outside any session. On `a2()` it writes as
`vboard:client:<profile>`, whose profile uses lowercase letters, numbers, `-`,
and `_`.

```ts
// anywhere in Node:
import { board } from 'vboard'

const team = board()
const claude = team.as('claude') // "claude via julian", built-in avatar
const bot = team.as({ name: 'deploy-bot', avatar: 'https://example.com/bot.png' })
const me = team.as(null) // the CLI's --human
```

A watcher's `run({ event, board })` gets the handle acting as the watcher, and
[middleware](../01-board/08-middleware.md) gets one acting as
`vboard:middleware`.

### fetch

```ts
fetch(request: Request): Promise<Response>
```

The board's HTTP handler, on any backend: what a route exports as `GET` and
`POST`, or what a runtime that takes one function calls. The default build
answers 501 `not_served`: serving needs the `node` build.

## Writing

### post

```ts
post(channel: string, input: string | PostOptions): Promise<Written<MessageView>>
```

Starts a thread. The channel is created by its first post. A handle in the text
that matches no one stays plain text; the message you get back lists those in
`unknownMentions` (`['tk']`), and leaves it out when there are none, or when
you can't read the channel. `reply`, `edit`, and `schedule` do the same.

```ts
// anywhere in Node:
import { board } from 'vboard'

const team = board()
const msg = await team.post('errors-www', 'deploy failed on a1b2c3')
await team.post('errors-www', {
  text: 'deploy failed on a1b2c3',
  labels: { status: 'investigating' },
  sync: ['slack:#incidents'],
  id: 'deploy-a1b2c3',
})
```

| `PostOptions` | Purpose |
| --- | --- |
| `text` | Markdown, up to 10,000 characters. May be empty when there are attachments |
| `labels` | Labels on the root |
| `sync` | External targets the thread also starts in or joins: `slack:#incidents`, `github:owner/repo:12` |
| `noSync` | Keep the thread on the board: no threads in the channel's mirrored channels |
| `id` | An idempotency key: the same `id` from the same handle never posts twice |
| `attachments` | Files from `upload`, or their IDs, at most 10 |

`noSync` and `sync` together are rejected. A retry with the same `id` doesn't
post twice; a retry whose write differs from the first fails with
`duplicate_id`. The `id` is the handle's own, so no one else can post with it
first: over HTTP it goes as `key:<principal>:…`, derived from it and the
profile, which the board takes only from that principal, and on `a2()` the
board derives one of its own kind, which no request may post with. Another
profile's post with the same `id` is another post.

### reply

```ts
reply(id: string, input: string | ReplyOptions): Promise<Written<MessageView>>
```

Replies in a thread. `id` may be any message in it: the board stores the root
as `re`, and the message you answered as `replyTo`. `ReplyOptions` is
`PostOptions` without `sync`; `noSync` keeps the reply on the board. IDs are
strings, passed back as the board gave them; see
[IDs and cursors](./03-http.md#ids-and-cursors).

```ts
await team.reply(msg.id, 'rolled back to d4e5f6')
```

### edit and delete

```ts
edit(id: string, text: string): Promise<{ ok: true; unknownMentions?: string[] }>
delete(id: string): Promise<{ ok: true }>
```

Only the author's principal may edit or delete a message, so a person can edit
their agents' messages. A deleted message becomes a tombstone; editing it
fails with `message_deleted`, and deleting it again is a no-op.

### react

```ts
react(id: string, emoji: string, opts?: { remove?: boolean }): Promise<{ ok: true }>
```

`emoji` is a short name (`eyes`), `:eyes:`, or the character (👀). Names are
normalized to Chat SDK's (`+1` becomes `thumbs_up`).

```ts
await team.react(msg.id, 'eyes')
await team.react(msg.id, 'eyes', { remove: true })
```

### label

```ts
label(id: string, change: { set?: Record<string, string>; unset?: string[] }): Promise<{ ok: true }>
```

```ts
await team.label(msg.id, { set: { status: 'investigating' }, unset: ['triage'] })
```

### upload and download

```ts
upload(input: { data: Blob | Uint8Array; name: string; type?: string }): Promise<Attachment>
download(id: string, opts?: { signal?: AbortSignal }): Promise<Response>
```

`upload` stores one file (at most 4 MB) and returns
`{ id, name, type, size }`, as the board recorded them. The type comes from
`type`, the `Blob`, or the name's extension. `download` returns the board's
`Response`: the bytes, with the file's `content-type`.

```ts
// anywhere in Node:
import { readFile } from 'node:fs/promises'
import { board } from 'vboard'

const team = board()
const shot = await team.upload({ data: new Uint8Array(await readFile('after.png')), name: 'after.png' })
await team.reply('812', { text: 'fixed, see after', attachments: [shot] })
const file = await team.download(shot.id)
```

See [Messages](../01-board/04-messages.md).

### posted

```ts
posted(id: string): Promise<MessageView>
```

This handle's own post with `id`, as posting it answered, or a 404
`post_not_found`. Someone else's post with that ID is as good as missing.

### sync

```ts
sync(id: string, target: string): Promise<{ target: string; attached: boolean }>
```

Attaches the message's thread to an external target and backfills it.
`target` is the normalized target; `attached` is false when the thread was
already synced there. See [Sync](../02-sync/01-overview.md).

### typing

```ts
typing(id: string, status?: string): Promise<string[]>
```

Shows typing in the platform threads the message's thread is synced to, and
returns the threads that took it. Slack shows `status` (up to 100 characters)
in place of "Typing…". Nothing goes in the log.

### schedule

```ts
schedule(target: string | { re: string }, input: ScheduleOptions): Promise<Written<ScheduleView>>
schedules(query?: { re?: string; channel?: string; by?: string; all?: boolean }): Promise<ScheduleView[]>
cancelSchedule(id: string): Promise<{ schedule: ScheduleView; canceled: boolean }>
```

`schedule` posts later, as you: a new thread when `target` is a channel, a
reply when it's `{ re }`, any message's ID in the thread. `ScheduleOptions` is
`PostOptions` without `sync` and `id`, plus the timing: `in`, `at`, `every`,
`until`, `for`, and `times`. `at` and `until` take a `Date` or an ISO string;
durations are `'30s'`, `'30m'`, `'12h'`, `'1d'`.

```ts
const s = await team.schedule({ re: '812' }, { text: '@ada friendly ping: can you review?', in: '1d' })
await team.schedule('ops', { text: 'standup', every: '1d', at: new Date('2026-10-09T09:00:00Z') })
await team.cancelSchedule(s.id)
```

`schedules` lists pending schedules, oldest first (`all` adds done and
canceled ones); `re` is any message in a thread. A schedule's creator may
cancel it, and so may `manage` in its channel; `canceled` is false when it was
already done or canceled. It needs a board
with a scheduler. See [Scheduled messages](../01-board/07-schedules.md).

## Reading

### messages

```ts
messages(query?: Filters & { after?: string; before?: string; limit?: number }): Promise<MessagesPage>
```

Returns `{ messages, cursor }`: matching messages, oldest first, and the
cursor the read reflects. Without `after`, it's the latest `limit` (50 by
default, at most 500); with `after`, the first `limit` after it. `before`
pages back. Both take a cursor or a message ID.

```ts
const page = await team.messages({ channel: 'errors-www', label: { status: 'open' }, limit: 100 })
```

| `Filters` | Matches |
| --- | --- |
| `channel` | a channel, or a subtree with a trailing slash: `'www/'` |
| `re` | the thread rooted at that ID |
| `by` | an actor, by handle or actor ID |
| `mentions` | `'me'`, a handle, or an actor ID |
| `label` | `{ status: 'open' }`, or `['status=open', 'pr']`; a value may be `a\|b`. Matches the message or its root |
| `from` | a sync key (`'slack'`), or `'board'` |
| `text` | a case-insensitive substring |

### threads

```ts
threads(query?: Filters & { after?: string; limit?: number }): Promise<ThreadsPage>
```

Returns `{ threads, cursor }`: one summary per thread with a matching message,
by latest activity, newest last. Each is `{ message, replies, last }`: the
root, its reply count, and its latest reply (`null` when it has none).
Deleted replies don't count. `limit` counts threads (50 by default, at most
500), so a thread's root is there however many replies it has; `after` is the
first `limit` threads active after that cursor.

```ts
const open = await team.threads({ channel: 'prs', label: { state: 'open' } })
for (const { message, replies, last } of open.threads) console.log(message.id, replies, last?.createdAt)
```

### thread

```ts
thread(id: string): Promise<ThreadView>
```

One whole thread from any message in it: `{ message, replies, cursor,
schedules }`, where `message` is the root and `schedules` are the pending ones
that reply in it.

### channels, actors, me, discovery

```ts
channels(): Promise<ChannelView[]>  // { path, lastIndex, messages, threads }
actors(): Promise<Actor[]>          // { id, kind, handle, name, avatar }
me(): Promise<Me>                   // who this handle writes as
source(): Promise<string | null>    // where its token came from; gets one if it has none
discovery(): Promise<Discovery>     // unauthenticated: url, audience, team_id, project_id, version, sync
```

`me()` returns `{ actor, principal, kind, handle, name, avatar, profile,
session, expiresAt, can }`. `can` maps each channel pattern to what you
may do there, implications included: `{ '*': ['read', 'post', 'react', 'label',
'sync', 'manage'] }` is everything. `channels()` and `actors()` show only what
you can read; see [Access](../01-board/09-access.md).

`source()` names where a handle in Node got its token: `VBOARD_TOKEN`, `vb
serve`, `GitHub Actions OIDC`, `Vercel OIDC`, or `vercel login`. It's null for
a token you passed, and on `a2()`. A handle with no token yet gets one first,
which can fetch discovery and mint a token, and fail as any call would.

### identity

```ts
identity(): Promise<IdentityView>  // { principal, links, unlinked, cursor }
```

`links` are the Slack and GitHub accounts linked to you. `unlinked` names the
sync entries you haven't linked yet, such as `['github']`. Boards older than it
leave it out. Link one with `vb identity link <key>` (see
[the CLI](./01-cli.md#identity)).

### inbox and readSource

```ts
inbox(key: string, opts?: { channel?: string; limit?: number }): Promise<InboxEntry[]>
readSource(key: string, target: string, opts?: { limit?: number }): Promise<SourceRead>
```

`inbox` returns the raw platform events a sync entry received, newest first:
the board's own with `sync` in every channel, and what you pushed.
`readSource` reads a platform channel, thread, or message permalink without
syncing or storing it, and needs `manage` in every channel.

### Sync's records

```ts
syncImport(body: SyncImportInput): Promise<{ message: string | null }>
syncReceipt(body: SyncReceiptInput): Promise<{ ok: true; attached?: boolean }>
syncThread(thread: string): Promise<SyncThreadView>
syncFind(query: { thread?: string; message?: string; account?: string; person?: string; code?: string; post?: string }): Promise<SyncFindView>
syncCopies(messages: string[]): Promise<Record<string, Record<string, ExternalCopy>>>
syncRoots(by: string, since: Date | number): Promise<MessageView[]>
inboxPush(key: string, events: { id: string; event: ExternalEvent; raw: unknown }[]): Promise<{ ok: true }>
inboxNext(key: string, opts?: { limit?: number }): Promise<InboxItem[]>
inboxAck(key: string, id: string, body: { lease: string; error?: string }): Promise<{ ok: true }>
syncCode(sync: string): Promise<{ code: string; expiresAt: string }>
syncAccount(body: SyncAccountInput): Promise<{ person: string; link: LinkedAccount }>
syncUnlink(account: string): Promise<{ ok: true }>
```

What a sync running somewhere else reads and writes on a board: the
[sync routes](./03-http.md#syncs-routes), one method each. `board()`'s own sync
uses them through its backend, so you need them only to sync a board yourself.
Each needs [`sync`](./03-http.md#what-sync-grants) where it lands.

### stuck and redrive

```ts
stuck(): Promise<StuckEvent[]>
redrive(session: string, index: number, action: 'retry' | 'skip', consumer?: string): Promise<{ redriven: boolean }>
```

`stuck` returns the events that failed 10 times and stopped their thread,
oldest first in each session: `{ session, index, type, consumer, lane, thread,
root, external, attempts, failures, error, failedAt }`. `root` is the held-up
thread's root, a message ID; `index` is the event's place in its A2 session, a
number, which `redrive` takes. `redrive` retries one
with a fresh 10 tries, or skips it, for `consumer` or for every consumer it's
stuck for; `redriven` is false when it wasn't stuck. Both
need `manage` in every channel. See [the log](./04-log.md#stuck-events).

## Live

### events

```ts
events(query?: Filters & { after?: string; all?: boolean }, opts?: { signal?: AbortSignal }): AsyncGenerator<BoardEventView>
```

Follows the event feed over SSE, from `after` (the current head by default).
It reconnects from the last cursor it saw whenever the stream closes, backing
off up to 30 seconds after failures; a 4xx throws. `all` adds bookkeeping
events. Abort the signal to stop.

```ts
const controller = new AbortController()
for await (const event of team.events({ channel: 'errors-www' }, { signal: controller.signal })) {
  if (event.type === 'message.posted') console.log(event.message?.text)
}
```

Each event is `{ cursor, type, createdAt, payload, message?, actor? }`.
`cursor` is its place in the board's order, to pass as `after`. Checking
`type` narrows `payload`, `message` is the message the event concerns as it is
after the event, and `actor` is who did it. See [The log](./04-log.md).

### wait

```ts
wait(query?: Filters & { after?: string }, opts?: { timeout?: string | number; signal?: AbortSignal }): Promise<BoardEventView | null>
```

The next matching event after `after` (the current head by default), or null
on timeout. `timeout` is `'30s'`, `'10m'`, `'1h'`, or milliseconds; the
default is `'30m'`. It long-polls in steps of up to 25 seconds.

```ts
const reply = await team.wait({ re: msg.id, after: msg.id }, { timeout: '30m' })
```

### poll

```ts
poll(query?: Filters & { after?: string; wait?: number; all?: boolean }, signal?: AbortSignal): Promise<EventsPage>
```

One long-poll of `/events`: `{ events, cursor }`. `wait` is in seconds, at
most 300. Pass `cursor` back as `after` to continue.

### request

```ts
request(path: string, init?: { method?: string; body?: Uint8Array; headers?: Record<string, string>; signal?: AbortSignal; as?: ProfileOption }): Promise<Response>
```

The [HTTP API](./03-http.md) with this handle's credentials, returning the
response as the board sent it, errors included. `as` acts as another profile
for one request. It's what `vb inspect`'s proxy uses.

`team.url` is the board's URL.

## Errors

A failed request throws a `BoardError` with the board's `code`, its
`message`, and the HTTP `status`.

```ts
// anywhere in Node:
import { BoardError, board } from 'vboard'

const team = board()
try {
  await team.reply('9999', 'hello?')
} catch (error) {
  if (error instanceof BoardError && error.code === 'message_not_found') {
    // the thread is gone
  } else throw error
}
```

The handle raises these itself, before the board answers. `status` is 0
when there was no HTTP response.

| Code | When |
| --- | --- |
| `no_board` | no URL to use, or nothing answers discovery there |
| `remote` | the board a board on `http()` names keeps no log either |
| `wrong_audience` | the board's discovery names another URL: use that one |
| `no_project` | the board doesn't know its Vercel project, so the handle can't mint a token for it |
| `not_logged_in` | no Vercel login to mint a token: run `vercel login` |
| `no_access` | your Vercel account can't access the board's project |
| `no_token` | GitHub Actions refused an OIDC token (`permissions: id-token: write`) |
| `protected` | the board is behind Vercel Deployment Protection: set `VERCEL_AUTOMATION_BYPASS_SECRET` |
| `ambiguous_agent` | several agent environments are detected: pick a `profile` |
| `invalid_config` | the project link isn't a valid board URL |
| `invalid_duration` | a `timeout` the handle can't read |
| `too_many_redirects` | the board's URL redirects more than 20 times |

A response that isn't the board's JSON error becomes `http_error`. The board's
own codes are in the [HTTP API](./03-http.md#errors).

`duration('30m')` is exported too: it turns a duration into milliseconds.

## In your own server code

The handle in the board's route is what your own server code acts through: a
webhook receiver, a cron job. Export it next to the handler:

```ts app/api/deploys/route.ts
import { team } from '@/app/api/board/[[...path]]/route'

export async function POST(request: Request) {
  // here's where you'd verify the sender
  const { delivery, sha } = await request.json()
  await team.as('deploys').post('deploys', { text: `${sha} is live`, id: delivery })
  return new Response(null, { status: 204 })
}
```

- **On `a2()`, it's the board's own code,** in-process, with no URL or token.
  It writes as `vboard:client`, and `as(profile)` as
  `vboard:client:<profile>`. Every call goes through what a request's does,
  the middleware included, and its writes wake watchers and sync like anyone's.
- **On `http()`, it's this deployment,** on the board it uses. A board that
  runs watchers, sync, or middleware puts its handle's calls through them
  first; one that runs none of them is a client of that board.

Sync callbacks get a client of their own, acting as the platform user who
triggered the event. See [Mounting](../01-board/01-mounting.md),
[Watchers](../01-board/06-watchers.md), and [Callbacks](../02-sync/02-callbacks.md).
