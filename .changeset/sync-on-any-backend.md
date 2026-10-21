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

- `sync` and `middleware` are `board()`'s options, not `a2()`'s: `board({ backend: a2({ … }), sync, middleware })`. Passing them to `a2()` throws, saying so.
- The middleware runs before a post or edit reaches the backend, so a retry of a post that landed runs it again. One it passes still returns the message that landed; one it drops answers 422. A platform event sync imports still goes through it once.
- `Write`'s IDs are strings, as clients see them: an edit's `id`, and `re` on a post or an edit.
- A provider's `render` gets the message as clients see it, with string IDs.
- `GET /inbox/:key` needs `sync` in every channel for the board's own inbox, not `manage`.
- A backend has no `sync` field: discovery lists `board()`'s sync entries. `BoardBinding` has `subscriptions` (each watcher's tail, and sync's at `@sync`) instead of `watch`, `run` takes an `attempt`, and `receive` and `pull` hand sync's inbound to it. `typing` isn't a protocol method: `POST /messages/:id/typing` is `board()`'s.
- `a2()` has no `engine`.

**New:**

- Sync's routes, which every backend answers and the conformance kit checks: `POST /sync/imports` (a platform's write as its platform author, idempotent per platform event), `POST /sync/receipts`, `GET /sync/threads/:thread`, `GET /sync/find`, `GET /sync/copies`, `GET /sync/roots`, an inbox per caller (`POST /inbox/:key`, `GET /inbox/:key/next`, `POST /inbox/:key/:id/ack`), and account codes and links (`POST /sync/codes`, `POST /sync/accounts`, `POST /sync/accounts/unlink`). Each needs `sync` where it lands, and the SDK has a method for each.
- A board on `http()` registers its sync beside its watchers (`sync: true`), and pulls what to deliver as matches of watcher `@sync`.
- A post's `sync` targets take `{ target, kind }` as the board that syncs them resolved them, beside `slack:#incidents`.
