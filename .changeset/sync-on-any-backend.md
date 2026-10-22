---
'vboard': minor
---

Sync runs in `board()`, so it works on any backend, a board on `http()` included. A project whose board uses the team's syncs its own Slack, GitHub, or WhatsApp: webhooks land on the project's board, what it imports lands on the team's as the platform user, and what the team's channels say goes out from the project, with its receipts recorded on the team's board. The team's board lets the project's deployment `sync` in those channels, which says it may speak for platform users there. The team's middleware sees what the project imports, told it came from Slack, and when it drops one, the answer carries what it responded and the project's sync says it in the Slack thread.

```ts
const project = board({
  backend: http('https://board.example.com/api/board'),
  sync: { slack: slack({ adapter: 'slack/acme', channels: { '#support': 'support' } }) },
})
export const GET = project.fetch, POST = project.fetch
```

**Breaking:**

- `access` is `a2()`'s, where the log is: `a2({ access: [vercelProject(…), …] })`, and so are `authenticate` and `middleware`. `a2({ access: (principal) => can })` says what a host's principals may do, asked again at every send of a schedule. `BoardBinding` has no `accessFor`; it hands the backend board()'s `sync` entries.
- `http()` has no `init`: a board on it answers only wake-ups, webhooks, and its sync's sign-ins.
- An import's author, and an account a sync links, must be a user of a platform the caller syncs: never an ID the board authenticates (`vercel:`, `github:repo:`, `oidc:`, `local:`, `vboard:`), nor a host's principal the board has seen register or write, or its agents and registered watchers (`<principal>+<id>`). A sync names its platforms when it registers.
- Codes go only to people, each for themselves, from the board that keeps the log: `POST /sync/codes` takes no `person`, and `POST /sync/accounts` links an account only by a code (`{ sync, account, code }`). A sign-in carries a code: on a board whose sync runs elsewhere, the person signs in at that sync's `/identity/sign-in`, and it redeems the code at `/identity/signed-in`. `UserTokens.authorize` takes a `callback`.
- A registration's `sync` is its sync entries, `[{ key, platform, signIn }]`, not a flag, and registering them needs `sync` somewhere (403). The board lists them in discovery and links accounts on them while their registrant may still sync, so `vb identity link` on the team's board links a project's entries too. A key the board's own sync has is its own; a key two registered syncs claim has no sign-in, and a code links it by posting it.
- `POST /sync/accounts/unlink` unlinks someone else's account only for `sync` in every channel, not somewhere.
- `GET /sync/find` answers `account` and `person` only with accounts on the platforms the caller syncs.
- `sync` is `board()`'s option, not `a2()`'s, and `middleware` is `a2()`'s: `board({ backend: a2({ middleware }), sync })`. TypeScript flags each where it doesn't belong.
- Sync's records are each one board thread's or message's: an import's `origin` is under its `from` key, and can't take a platform thread or message another board thread or message has (409 `already_synced`; a reply's is its own thread's, 409 `not_synced`). A delivery receipt is for one of its thread's targets (400 `not_a_target`), under a key the caller syncs (403), and lands in no other thread's platform thread or message (409). Each sync delivers only to its own keys' targets, so a board's own sync and a sync elsewhere don't hold each other's threads up.
- `board()` does what it does for a request beyond calling the backend (resolving a sync target on a platform, which can join a Slack channel, looking up an `@[email]` and recording who it is, reading an upload) only once the backend's `me` says the caller may: `post` where the write lands, and `sync` there for its targets. A request it may not goes to the backend as it came, and nothing reaches a platform for it.
- A post or a schedule from a caller that can't read its channel comes back with the text it sent, never the actor an email resolved to, and `GET /posts/:id` and `GET /schedules` show such a caller each exact mention but of itself as `@…`.
- Sync renders a reply or an edit as the message is when it goes out, so a delivery that runs late sends what its author has since edited, and nothing they deleted.
- A post's `id` can't start with `sync:` (400): an import from a sync elsewhere lands as `sync:<principal>:…`, which anyone could work out and take first.
- `POST /sync/imports` takes `source: { key, channel, thread }` on a post or an edit, where on the platform it came from, for the middleware, and answers `dropped`, what the middleware responded, when it keeps one off the board.
- A middleware's `respond` goes back with a write it drops: for sync, a reply in the platform thread, as before, and nothing for a write it lets through.
- `Write`'s IDs are strings, as clients see them: an edit's `id`, and `re` on a post or an edit.
- A provider's `render` gets the message as clients see it, with string IDs.
- `ProviderFile.data` is a `Uint8Array`, which a Node `Buffer` is: a provider of your own gets a file's bytes as one, not as a `Buffer`.
- `GET /inbox/:key` needs `sync` in every channel for the board's own inbox, not `manage`.
- A sync callback's own writes through `board` (a reply, a label, a reaction, an edit or delete of the user's own message) are imports as its platform user, and its reads are sync's: on every backend, a board on `http()` included. A `schedule` or a `me()` from a callback is sync's now, not the platform user's.
- A backend has no `sync` field: discovery lists `board()`'s sync entries. `BoardBinding` has `subscriptions` (each watcher's tail, and sync's at `@sync`) instead of `watch`, `run` takes an `attempt`, and `receive` and `pull` hand sync's inbound to it.
- `a2()` has no `engine`.

**New:**

- `GET /posts/:id`, the protocol method `posted`: the caller's own post with the client ID it gave, as it landed.
- Sync's routes, which every backend answers and the conformance kit checks: `POST /sync/imports` (a platform's write as its platform author, idempotent per platform event, naming the message a change is about by its platform IDs or its board ID), `POST /sync/receipts`, `GET /sync/threads/:thread`, `GET /sync/find`, `GET /sync/copies`, `GET /sync/roots`, an inbox per caller (`POST /inbox/:key`, `GET /inbox/:key/next`, `POST /inbox/:key/:id/ack`), and account codes and links (`POST /sync/codes`, `POST /sync/accounts`, `POST /sync/accounts/unlink`), with `GET /sync/find?code` naming whose code it is. `board()` signs people in for a consent entry at `GET /identity/sign-in` and `GET /identity/signed-in`, which take no board token. Each needs `sync` where it lands, and the SDK has a method for each.
- A board on `http()` registers its sync entries beside its watchers, and pulls what to deliver as matches of watcher `@sync`.
- A post's `sync` targets take `{ target, kind }` as the board that syncs them resolved them, beside `slack:#incidents`.
