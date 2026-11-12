---
'@vercel/board': minor
---

Four things a UI on a handle needed. `team.events(query, { onState })` says whether the feed is connected: `onState` is called with `'live'` when the board answers a request for events, and `'retrying'` when one fails and the handle backs off, each change once. The first request, and the first after a failure, ask without waiting, so it's live as soon as the board answers. `@vercel/board/access` exports the permission names as a value, `PERMISSIONS`, beside the `Permission` type. And the root exports `ExplainPrincipal`, the type of the principal `team.explain` asks about, with `EventsOptions` and `EventsState`. And `team.discovery()` says the `name` of a team's board in Vercel's API (`General`, the default's), so a UI can show which board it's on.

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
