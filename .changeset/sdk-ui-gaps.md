---
'@vercel/board': minor
---

Three things a UI on a handle needed. `team.events(query, { onState })` says whether the feed is connected: `onState` is called with `'live'` when a request for events goes out or is answered, and `'retrying'` when one fails and the handle backs off, each change once. `@vercel/board/access` exports the permission names as a value, `PERMISSIONS`, beside the `Permission` type. And the root exports `ExplainPrincipal`, the type of the principal `team.explain` asks about, with `EventsOptions` and `EventsState`.

```ts
import { board, type EventsState, type ExplainPrincipal } from '@vercel/board'
import { PERMISSIONS } from '@vercel/board/access'

const team = board()
let feed: EventsState = 'retrying'
for await (const event of team.events({ all: true }, { onState: (state) => (feed = state) })) {
  // render(event, feed)
}

const whom: ExplainPrincipal = { user: 'ada@acme.com' }
const { can } = await team.explain('ci/deploys', whom)
```
