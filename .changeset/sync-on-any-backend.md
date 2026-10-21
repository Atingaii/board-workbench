---
'vboard': minor
---

Sync and middleware run in `board()`, so they work on any backend, a board on `http()` included. A project whose board uses the team's syncs its own Slack, GitHub, or WhatsApp: webhooks land on the project's board, what it imports lands on the team's as the platform user, and what the team's channels say goes out from the project, with its receipts recorded on the team's board. The team's board lets the project's deployment `sync` in those channels, which says it may speak for platform users there.

```ts
export const { GET, POST } = board({
  backend: http('https://board.example.com/api/board'),
  sync: { slack: slack({ adapter: 'slack/acme', channels: { '#support': 'support' } }) },
  middleware: [guard],
})
```

**Breaking:**

- `sync` and `middleware` are `board()`'s options, not `a2()`'s: `board({ backend: a2({ … }), sync, middleware })`. TypeScript flags them on `a2()`.
- `Write`'s IDs are strings, as clients see them: an edit's `id`, and `re` on a post or an edit.
- A provider's `render` gets the message as clients see it, with string IDs.
- `GET /inbox/:key` needs `sync` in every channel for the board's own inbox, not `manage`.
- A sync callback's own writes through `board` (a reply, a label, a reaction, an edit or delete of the user's own message) are imports as its platform user, and its reads are sync's: on every backend, a board on `http()` included. A `schedule` or a `me()` from a callback is sync's now, not the platform user's.
- The Node client and the CLI pointed at a board on `http()` follow it to the board it uses, minting a token for that board, instead of failing with `keeps no log`. Linking an account on that board's own sync entries (`vb identity link`) and reading a source through one stay with it. A client handed a token for one board stays there.
- A backend has no `sync` field: discovery lists `board()`'s sync entries. `BoardBinding` has `subscriptions` (each watcher's tail, and sync's at `@sync`) instead of `watch`, `run` takes an `attempt`, and `receive` and `pull` hand sync's inbound to it. `typing` isn't a protocol method: `POST /messages/:id/typing` is `board()`'s.
- `a2()` has no `engine`.

**New:**

- `GET /posts/:id`, the protocol method `posted`: the caller's own post with the client ID it gave. `board()` asks it before the middleware, so a retried post that landed skips the middleware on any backend.
- Sync's routes, which every backend answers and the conformance kit checks: `POST /sync/imports` (a platform's write as its platform author, idempotent per platform event, naming the message a change is about by its platform IDs or its board ID), `POST /sync/receipts`, `GET /sync/threads/:thread`, `GET /sync/find`, `GET /sync/copies`, `GET /sync/roots`, an inbox per caller (`POST /inbox/:key`, `GET /inbox/:key/next`, `POST /inbox/:key/:id/ack`), and account codes and links (`POST /sync/codes`, `POST /sync/accounts`, `POST /sync/accounts/unlink`). Each needs `sync` where it lands, and the SDK has a method for each.
- A board on `http()` registers its sync beside its watchers (`sync: true`), and pulls what to deliver as matches of watcher `@sync`.
- A post's `sync` targets take `{ target, kind }` as the board that syncs them resolved them, beside `slack:#incidents`.
