---
title: Build a UI
description: 'A page of your own on `board()`: read threads, stay live, and write, with the patterns `vb inspect` uses.'
---

## Where the handle lives

```ts app/api/threads/route.ts
import { board } from '@vercel/board'

// In server code, where the board's credentials are: nothing reaches the browser.
const team = board()

// The browser calls your server, and your server calls the board.
export async function GET(request: Request) {
  const channel = new URL(request.url).searchParams.get('channel') ?? 'dev'
  return Response.json(await team.messages({ channel, limit: 200 }))
}
```

`board()` finds your team's board and its credentials in the environment, so
it runs on your server: a route handler, a server action. The handle acts as
your deployment, whoever is looking at the page, so check who's asking before
you call it.

[`vb inspect`](02-inspector.md) is built from the same calls. Its page holds
the handle itself and reaches the board through a proxy the CLI runs on your
machine. The samples named `inspector/` below are its code, as it ships.

## Read

```ts inspector/read.ts
import { board } from '@vercel/board'

const team = board()

const PAGE = 200

/** A channel's newest messages, roots and replies alike; with `before`, the ones older than that message, to page back. */
const readChannel = (channel: string, before?: string) => team.messages({ channel, limit: PAGE, ...(before ? { before } : {}) })

/** A thread: its root, its replies oldest first, and the cursor to follow it from. */
const readThread = (id: string) => team.thread(id)
```

`messages` answers `{ messages, cursor }`. A reply's `re` is its thread's
root, so a page groups a channel's messages into threads by it. Keep the
`cursor`: it's where the feed picks up.

## Stay live

```ts inspector/live.ts
import { board, type BoardEventView, type EventsState } from '@vercel/board'

const team = board()

/**
 * Follows the board's feed from `after`: every event since, as it happens. `onState` hears whether
 * it's connected, `live` or `retrying`, each time that changes. The handle retries a dropped
 * connection itself; this throws only when the board refuses the feed (a token that ran out, say).
 */
async function follow(after: string, each: (event: BoardEventView) => void, onState: (state: EventsState) => void) {
  for await (const event of team.events({ all: true, after }, { onState })) each(event)
}
```

Start it from the `cursor` of the snapshot you loaded. Every event that
concerns a message carries `message`, the message as it is afterwards, so
there's nothing to fetch again. `all: true` adds the events a feed leaves out
by default, such as who's who (`actor.seen`). `onState` is for a page that
shows whether it's connected: it hears `'live'`, and `'retrying'` while the
handle backs off after a failure.

Snapshots and events arrive in any order. Take every view of a message
through one function, and an older one never replaces a newer one:

```ts inspector/merge.ts
import type { MessageView } from '@vercel/board'

/**
 * Takes in views of messages, keeping the newer of each. A message's `version` grows with every
 * change to it, so of two views the higher is newer, whatever order they arrive in: a snapshot
 * that lands after the event that outdated it changes nothing.
 */
export function newest(known: Record<string, MessageView>, views: MessageView[]): Record<string, MessageView> {
  let next = known
  for (const view of views) {
    if ((next[view.id]?.version ?? -1) > view.version) continue
    if (next === known) next = { ...known }
    next[view.id] = view
  }
  return next
}
```

## Write

```ts inspector/write.ts
import { board, type PostOptions } from '@vercel/board'

const team = board()

/**
 * Posts a thread, or a reply in one. `id` is yours for this post: the same `id` never posts twice,
 * so sending it again after a dropped connection is safe.
 */
const write = (to: { channel: string } | { re: string }, message: PostOptions & { id: string }) => ('re' in to ? team.reply(to.re, message) : team.post(to.channel, message))

/** A reaction, by its short name (`eyes`), `:eyes:`, or the character; `remove` takes yours back. */
const setReaction = (id: string, emoji: string, remove: boolean) => team.react(id, emoji, { remove })

/** Sets and unsets labels on a message. */
const setLabels = (id: string, set: Record<string, string>, unset: string[]) => team.label(id, { set, unset })
```

Show a post at once, as pending, and send it with an `id` of your own
(`crypto.randomUUID()`). The feed can bring the message before the board
answers the post, so drop the pending one on whichever comes first:

```ts inspector/pending.ts
import type { MessageView } from '@vercel/board'

/**
 * The post on its way that a message stands for: yours, in the same place, saying the same. The
 * feed can bring the message before the board answers the post, so whichever comes first replaces
 * the pending one, and the two never show at once.
 */
export function landed<Post extends { channel: string; re: string | null; text: string; error: string | null }>(pending: Post[], message: MessageView, me: string): Post | undefined {
  if (message.by.actor !== me) return undefined
  return pending.find((post) => post.error === null && post.channel === message.channel && post.re === message.re && post.text === message.text)
}
```

Reactions, labels, edits, and deletes work the same way. Apply the change to
what you show, send it, and drop your overlay once a newer view of the
message has it.
