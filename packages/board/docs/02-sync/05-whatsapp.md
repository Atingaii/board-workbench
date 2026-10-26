---
title: WhatsApp
description: Sync WhatsApp conversations on a business number with board threads, through Kapso.
---

## Configure it

```package-install
npm i chat @kapso/chat-adapter @kapso/whatsapp-cloud-api
```

`kapso({ adapter, markRead }, sync)` takes
[Kapso's Chat SDK adapter](https://chat-sdk.dev/adapters/vendor-official/kapso),
a read operation, and a [sync function](./02-functions.md). `numbers` makes one
from a map of WhatsApp phone number IDs to board channels (two-way mirrors) or
functions of your own:

```ts app/api/board/[[...path]]/route.ts
import { board } from '@vercel/board'
import { a2 } from '@vercel/board/backend-a2'
import { vercelQueues } from '@vercel/board/backend-a2/scheduler-vercel'
import { postgres } from '@vercel/board/backend-a2/store-postgres'
import { kapso, numbers } from '@vercel/board/sync-kapso'
import { createKapsoAdapter } from '@kapso/chat-adapter'
import { WhatsAppClient } from '@kapso/whatsapp-cloud-api'

const client = new WhatsAppClient({
  baseUrl: 'https://api.kapso.ai/meta/whatsapp',
  kapsoApiKey: process.env.KAPSO_API_KEY!,
})

const backend = a2({
  store: postgres({ connectionString: process.env.DATABASE_URL! }),
  scheduler: vercelQueues({ topic: 'board' }),
})

const team = board({
  backend,
  sync: {
    kapso: kapso(
      {
        adapter: createKapsoAdapter({ client }),
        markRead: (input) => client.messages.markRead(input),
      },
      numbers({ '16315558151': 'support' }),
    ),
  },
})
export const GET = team.fetch, POST = team.fetch
export const { scheduler } = backend
```

Keys are phone number IDs as Kapso shows them, not the phone numbers themselves.
A key that isn't one is skipped with a warning that says so.

`markRead` is required at setup. The adapter only remembers messages whose webhook
reached its own instance, so typing and read receipts go through this operation
instead, which works from any serverless instance.

| Thing | ID |
| --- | --- |
| A business number, the channel | `kapso:16315558151` |
| A Kapso conversation, a thread | `kapso:16315558151:<WhatsApp ID>:<conversation ID>` |

Kapso's adapter encodes each part of its IDs; the board writes them decoded, so
targets and `vb inbox` read as above.

## Conversations are threads

WhatsApp has no threads, so a contact's messages group into Kapso's conversations.
One starts when they write, and ends after a day of quiet or when someone closes it
in Kapso. Writing again after that starts a new board thread.

- **Authors** are `whatsapp:user:<WhatsApp ID>`, named by their WhatsApp profile
  name.
- **The board never starts a conversation.** A number has no threads to start, so
  a root posted in a mirrored channel stays on the board.
- **Board messages post from the business number,** with the author's name in bold
  (`*julian*: refunded`). To post the text alone, wrap the function in
  `render(({ message }) => message.text, …)`; see [render](./02-functions.md#render).

## Reply within the window

WhatsApp takes free-form messages only within 24 hours of the contact's last one.
A board reply after that fails, and is recorded as `message.sync_failed`, which
`vb read` shows under it:

```text
✗ didn't reach kapso:16315558151:51987654321:conv_123: <WhatsApp's error>
```

Templates aren't synced; send them with `@kapso/whatsapp-cloud-api`.

## Reactions

WhatsApp keeps one reaction per person per message. A contact's new reaction
replaces their old one on the board, and removing it clears it. The business number
has one too: the board's reactions on a WhatsApp message show there as the latest
one added, and removing any of them clears it.

## Media

An image, video, voice note, or document becomes an attachment on the board,
fetched through Kapso, with its caption as the text. A voice note's transcript is
quoted under it when Kapso has one. A board without a blob store keeps no files:
each is a line in the text instead, as on [Slack](./03-slack.md#files).

A board message's files follow its text to WhatsApp, each as its own message.
WhatsApp can't delete them, so they stay when the board message is deleted.

## Typing

```ts
// in the route that mounts the board with its `sync`:
await team.typing('812')
```

Shows "typing…" to the contact and marks their latest message read (blue ticks).
WhatsApp shows no status text, so a status is ignored.

## Route by function

A function for a number receives every event for it, both ways. Importing a
message into a channel connects its conversation, and delivering sends board
replies in that thread to the contact:

```ts
// in kapso({ … }, numbers({ … })):
'16315558151': async (sync) => {
  if (sync.direction === 'out') return sync.deliver()
  if (sync.event.kind !== 'message') return
  await sync.import('leads', { text: `${sync.event.author.name}: ${sync.event.text}` })
},
```

See [sync functions](./02-functions.md) for the event and the overrides.

## What doesn't sync

- Edits and deletes, which WhatsApp can't do for recipients.
- Button and list replies.

## Setup

1. In Kapso, create an API key and copy the number's phone number ID.
2. Add a webhook with the URL `https://<host>/api/board/webhooks/kapso`, a secret
   key, and the `whatsapp.message.received` event.
3. Set `KAPSO_API_KEY` and `KAPSO_WEBHOOK_SECRET`, or pass `webhookSecret` to
   `createKapsoAdapter`. Without the secret, the adapter rejects every webhook.

The webhook path ends in the entry's key, so an entry keyed `kapso` listens at
`/webhooks/kapso`.
