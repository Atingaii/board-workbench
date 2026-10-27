# vboard

## 0.19.0

### Minor Changes

- 4b99190: `POST /watchers` takes a `path` instead of a `url` on a board whose discovery says `wake_by_path`: that board wakes the caller's own Vercel project at the path, through its Deployment Protection, taking the project and environment from the caller's token, so a project can only register itself, and anyone else gets 403 `not_a_project`. A board on `http()` on Vercel registers its mount path there instead of its URL, from production, or from a preview with its `branch`, whose latest ready deployment is woken. `a2()` can't find a project's deployments, so it answers a path with 501 `no_wake_by_path`, and `vb conformance` checks a board does one or the other as its discovery says.

## 0.18.1

### Patch Changes

- abe07e0: The CLI and `board()` in Node get through Vercel Connect passport the way they get through Vercel Authentication, with the project's Protection Bypass for Automation. Passport answers a fetch with Vercel's own 401 instead of a redirect, so they reported `no board at <url> (401)`.
- fad7778: `vb read <link>` on a board older than reading links says so: `error: this board can't read links: update board where the board is deployed`. It failed with `error: replies is not iterable`, since an older board answers `/links` with its discovery document.

## 0.18.0

### Minor Changes

- 5fee847: Add `@vercel/board/sync-linear`: `linear(app, teams({ ENG: 'dev' }))` turns each Linear issue into a board thread, with comments as replies and `issue` and `state` labels, and a board root in a mirrored team opens an issue.

### Patch Changes

- 3663db3: Update the Factory setup skill for current automation paths and scoped board tools.

## 0.17.0

### Minor Changes

- 76a63cc: `@vercel/board` installs only what a handle needs: `zod`, `jose`, and `@vercel/oidc`. A2 is inlined into board's own build, so installing board no longer installs `experimental-a2`, and a board on `a2()` needs nothing new. **Breaking:** sync's Chat SDK pieces are optional peers now. Sync through `@vercel/board/sync-slack` or `@vercel/board/sync-github` installs `chat`, the platform's `@chat-adapter/slack` or `@chat-adapter/github`, and `@vercel/connect` beside board. A project on `http()`, and the CLI, need nothing more, and their types don't reach any of these.
- 7b08ce5: **Breaking:** the Slack app no longer joins the channels it syncs: `/invite` it to each one. A channel ID routes events and posts without asking Slack anything, so a rate-limited `conversations.info` no longer holds up every webhook on a fresh instance. Until it's invited, a channel's events don't arrive and a post there fails with Slack's `not_in_channel`; the log names each channel mapped by name that the app isn't in. The app no longer needs `channels:join`, and `SlackClient` has no `conversations.join`.
- c155e7d: **Breaking:** each sync platform takes its app and one sync function, called for every event in both directions: `slack('slack/acme', channels({ '#prs': 'prs' }))`, `github('github/acme', repos({ 'acme/www': 'prs' }))`, `kapso({ adapter, markRead }, numbers({ '16315558151': 'support' }))`. Coming in, the function calls `sync.import(channel?, overrides?)`; going out, `sync.deliver({ render? })`, or `sync.start(channel)` for a new root. One that calls nothing does nothing. `channels`, `repos`, and `numbers` route by platform channel, and `mirror`, `into`, and `render(renderer, fn)` from `@vercel/board/sync` compose under them. A string under `repos` now imports only: what's said on the board or in Slack reaches GitHub only when a function delivers it (`mirror('prs')` sends everything, as before). Replace `channels: { … }` with `channels({ … })`, `{ channel, run }` and `async ({ event, board }) => board.sync(channel, event, overrides)` with a function that calls `sync.import(channel, overrides)` coming in and `sync.deliver()` going out, and the `render` option with `render(renderer, …)`. `SyncHandler`, `EventMapping`, and `SyncClient` are gone; `SyncProvider` takes the function as its constructor's second argument, and `UnreadableError` is exported from `@vercel/board/sync` for a provider's `resolveChannel` to say a channel doesn't exist.
- f384dd4: `vb sync <id>` with no target says where the message's thread is synced: a row a target, with the platform's link to the message's copy there, or why it didn't reach it. `vb read <link>` goes the other way, from a Slack permalink or a GitHub PR, issue, or comment to the board thread it's synced with. Both answer from sync's records alone, never asking the platform, and only for messages you can read: a link to anything else is `error: no message on this board for that link`. A handle has them as `board.sync(id)` and `board.linked(url)`, and the protocol as `GET /messages/:id/sync` and `GET /links?url=`.
  
  Providers get two optional methods for it, by the platform's own IDs: `locate(url)` reads a link as a thread and a message, and `url(thread, message)` makes one. Slack and GitHub implement both. `ChatSyncProvider`'s protected `locate(key, chatThread)` is now `locationOf`. A GitHub review thread (`github:owner/repo:12:rc:345`) is no longer a sync target, since its comments come in under its PR: `vb sync` says to sync the PR instead, and a link to a review comment synced from this release on finds it.

### Patch Changes

- ab83778: A PR or issue retitled on GitHub says its new title on its board root, and the root's copies on other platforms (its Slack line, say) are edited to match. An edit to only the description changes nothing. Sync functions see it as `pr.edited` or `issue.edited`.
- 7b08ce5: A platform's retry of an event the board already has is taken as received, even when it reads differently the second time (another instance took it, or a name changed in between). It answered 500 `intake failed` with A2's `PARTIAL_DUPLICATE_BATCH`, so Slack kept retrying it.
- 7b08ce5: A Slack app from a Vercel Connect connector gives up on a call after 3 more tries, where Slack's client tried 10 more over about 30 minutes, longer than a function lives, so a rate-limited webhook timed out instead of answering. Each try still waits out Slack's `Retry-After` (about a minute at most), and a request that hangs gives up after 30 seconds.

## 0.16.0

### Minor Changes

- 8895d07: A host's own verifier names its people's handles: the `x-board-handle` a caller sends (`vb --handle`, `BOARD_HANDLE`) no longer replaces the handle `authenticate` returns, so on a board that verifies who people are, nobody can take another person's handle or their mentions. It still fills in for people `oidcTokens()` verifies, since their token names only an ID. **Breaking** for a verifier that returns a stand-in handle and counts on the CLI's: return `{ ...principal, handle: request.claims.handle ?? principal.handle }`.

## 0.15.0

### Minor Changes

- 09b0871: Files over 4 MB, up to 100 MB, upload straight to the board's blob store: `client.upload()` and `vb --attach` do it by themselves on a board whose store can sign upload URLs. New: `POST /attachments/uploads` (`{ name, type, size }` → `{ id, url, headers, expiresAt }`), then `PUT` the bytes to `url`, then `POST /attachments/uploads/:id` → `{ attachment }`. `BlobStore` gains optional `uploadUrl(key, { contentType, maxBytes, expiresAt })` and `head(key)`, and `vercelBlob()` has both. Other stores keep the 4 MB limit and answer 501 `no_direct_uploads`.
- 09b0871: Files sync brings over from Slack and other platforms can be up to 25 MB, not 4 MB: sync fetches and stores them on the server, so Vercel Functions' request limit doesn't apply. On `http()`, sync sends files over 4 MB to the remote board as direct uploads, and a file that board can't take becomes a line in the text ("over 4 MB") instead of failing the import.
- 27e0e9c: vboard is board, on npm as `@vercel/board`: install it, and import from `@vercel/board` and its subpaths (`@vercel/board/backend-a2`, `@vercel/board/sync-slack`, …). The CLI's bins are `board` and `vb`, and `npx @vercel/board` runs `board`. Its environment is `BOARD_URL`, `BOARD_TOKEN`, `BOARD_AS`, `BOARD_HANDLE`, `BOARD_AVATAR`, and `BOARD_TRUSTED_SOURCES`, a project's link is `.board/`, and saved boards live in `~/.config/board`. **Breaking:** what a board stores is renamed too (its log's contract and consumers, its tables and Redis keys, its files' blob paths, and Postgres's `board_*` tables, from `node_modules/@vercel/board/sql/postgres/schema.sql`), so a board starts empty. `vb hooks install pi` writes `extensions/board.ts`, and the agent skill is `board`: `npx skills add vercel-labs/board --skill board -g`.

## 0.14.1

### Patch Changes

- 3f06e2a: Synced copies carry a handle no one on the board has as written, with no word joiner after its `@`. That also fixes a renderer's `mentionOf` mention, like Slack's `<@U0456>`, which went out as raw text instead of mentioning anyone.

## 0.14.0

### Minor Changes

- eb03d84: vboard runs on A2 0.22. On Upstash, a board's scripts no longer lock the whole database: each locks only its own keys, and no script publishes.
  
  **Redis (`redis()`, `redisHttp()`): give the store a new `keyPrefix`, then deploy.** Every key is named differently, so the board starts over there with an empty log, and never reads the old prefix's keys; delete them whenever you like. On a prefix vboard 0.13 wrote, every request answers 503 `unavailable` (`the redis keys under prefix '…' hold an A2 layout other than 'tagged-1'`). A `keyPrefix` can't contain braces. Message IDs start again from 1, so a synced board's old Slack and GitHub threads no longer map to board threads: a new reply in one brings it over as a new thread. Schedules start over too.
  
  Every key of a board's tables shares one hash tag, `<keyPrefix>:{<keyPrefix>:vboard}:<name>`, and every key of an A2 session shares its session's, so on Upstash each script sets `allow-key-locking` and locks only those keys; queries take the shared lock (`no-writes`). The store asks the server once whether it takes the flag: Redis and Valkey don't, and their scripts carry none.
  
  **Postgres (`postgres()`): apply 0.14's `node_modules/vboard/sql/postgres/schema.sql`, then deploy.** It replaces the unique index on `a2_events (event_id)` with one on `(session_id, event_id)`, keeping every row. The swap locks `a2_events` until the index is built; on a large table, build it by hand first, as https://www.a2.dev/upgrades/0-22 shows.
  
  **SQLite (`sqlite()`, `vb serve`):** nothing to do. The file's index changes when 0.14 opens it, so don't open it with an earlier vboard afterwards.
  
  Event IDs are unique per session, not per store. A registrant whose watchers pulled in the same minute as another's no longer gets a 409 `duplicate_id`: both of their sweeps derived one ID, and A2 0.21 let only the first land.
- ebe167e: `a2({ store?, scheduler?, blob? })` reads nothing from the environment: a board on it is what you pass, the same in development, tests, and production. `vboard/backend-a2/scheduler-local` exports `localScheduler()`, a scheduler whose timers live in the process, for development, `vb serve`, tests, and long-running servers (never serverless functions), which `vb serve` uses.
  
  ```ts
  import { a2, fsBlob } from 'vboard/backend-a2'
  import { localScheduler } from 'vboard/backend-a2/scheduler-local'
  
  // A dev server: SQLite at .a2/dev.db, timers in the process, and files in .a2/attachments.
  const backend = a2({ scheduler: localScheduler(), blob: fsBlob() })
  ```
  
  - **Without a store,** the board is SQLite at `.a2/dev.db` in the working directory, in every environment, which suits development and a single long-running server. Where that can't open, as on Vercel, whose deployments can't write there, every request answers 500 `no_store` (`can't open SQLite at .a2/dev.db: this filesystem isn't writable here, so pass a store to a2()`), and nothing stands in for it in memory: pass `postgres()`, `redis()`, or `redisHttp()`.
  - **Without a scheduler,** the consumers (the tables, watchers, sync's deliveries and inbox) run in the request that wrote. A failure is retried on the next write, and so is a lease that ran out or a wake-up that didn't arrive, which is fine for a tool and not enough for a production board with watchers or sync. Scheduling answers 501 `no_scheduler` (`vb schedule` says ``error: this board has no scheduler: pass `scheduler` to `a2()` to send later``).
  - **Without a blob store,** the board keeps no files: `POST /attachments`, a post, schedule, or import that carries files, and a download answer 501 `no_files` (``this board keeps no files: pass `blob` to `a2()` ``). Sync brings a platform's files over as links to where they live, one line each, and sends no files out.
  - `vb conformance` and `vboard/conformance` report the schedules and attachments checks as skipped, `not kept here`, on a board that answers them 501, rather than failing.
  
  **Breaking:**
  
  - `a2()` no longer keeps a board in memory in tests, or answers 500 `not_configured` in production: with no store, it's SQLite at `.a2/dev.db` everywhere. Pass `memory()` from `vboard/backend-a2/store-memory` in tests.
  - It no longer starts a scheduler in the process in development, or keeps files in `.a2/attachments` (development) or memory (tests) by default: pass `scheduler: localScheduler()` and `blob: fsBlob()` or `memoryBlob()` (from `vboard/backend-a2`) for what they had.
  - A board without a blob store answers 501 `no_files`, not 400 `no_blob_store`, and the `no_scheduler` message is new.
  - `BoardStore`'s `log` is required.
  - On a board with no store, the backend's `servers`, `session`, and `store` are there once its first request has opened the store.
- `board({ authenticate })` says who a request is. It's one function, `oidcTokens()` from `vboard/access` by default, the OIDC tokens made out to the board, and verifiers compose in plain code: each answers null when the request carries nothing it recognizes, and a 401 when its credential fails. A board on an app's own site takes the app's session cookie and `vb`'s tokens with `async (request) => (await staff(request)) ?? (await tokens(request))`, and its route checks the `Origin` of writes, since a cookie rides along on other sites' requests. A host's principals get what their kind does: `kind: 'person'` is a full member of the board, with everything, so the verifier decides who counts as one, and anyone else, `external` included, gets what the first rule that matches gives. A function can be one of those rules, `(principal) => can`, with null for nothing and undefined for the next rule, which is how a host's own IDs (`support:customer:99`) get anything: `access: [vercelProject(…), (principal) => (principal.id.startsWith('support:customer:') ? { 'support/': ['read', 'post'] } : undefined)]`. It's asked whenever a principal acts, a schedule's send and a registered watcher's match included, and never about a person or the board's own deployments in its environment.
  
  **Breaking:** 0.13.0's `board({ access: (request) => ({ id, kind, handle, can }) })` splits in two, both on `board()`, whatever keeps the log. `authenticate` says who the request is, as `{ id, kind, handle }`, and a function as `access` says what each principal may do, as `can`, or null for nothing. A host serving many teams' boards passes both, and nothing else is trusted then:
  
  ```ts
  // before
  board({ access: async (request) => ({ ...(await verify(request)), can: await canOf(request) }) })
  // after
  board({ backend: a2({ store }), authenticate: verify, access: async (principal) => canOf(principal.id) })
  ```
- 2949cd4: `board()` serves the protocol over HTTP on every backend, and a backend is a plain object that answers it: one method per route, `(caller, input, signal)`, called with the caller `board()` verified and the input the route's schema parsed. `board()` owns the policy, in one place on any backend: it verifies each request's caller, works out who it writes as, applies `access`, and runs the middleware, before anything else runs for it. It also serves SSE and discovery, and runs watchers and sync. A backend stores and answers, honoring what each caller may do, and asks `board()` through its binding about the principals it stores, at each schedule's send and each registered watcher's match. Write a backend of your own with `import { board, HttpError, type Backend } from 'vboard'`: the Mounting and Access pages show how, and `vb conformance` checks one against the whole protocol.
  
  **Breaking:**
  
  - `board()` takes `backend`, `authenticate`, `access`, `middleware`, `project`, `watch`, `sync`, `url`, `basePath`, and `streamMaxMs`. `store`, `scheduler`, and `blob` are `a2()`'s, which is the log and its engine.
  - `auth` is gone: its options go to `oidcTokens()` from `vboard/access`, `board()`'s default `authenticate`. `vb serve` passes `oidcTokens({ local })`, and tests `oidcTokens({ vercel, github, oidc })`.
  - A backend's `Caller` is `{ identity: { principal, author, actor }, origin }`, one `board()` verified, whose principal carries its `access`, or `{ self, origin }`, this deployment's own code. A backend trusts the first as it is: only `board()` makes one, in process. `Backend` has `keeps`, whether the board lives there: on one that doesn't (`http()`), `board()` serves no request but wake-ups and webhooks unless it has an `access` of its own. `BackendRoute` has no `auth`: `board()` verifies nothing for a backend's own routes, whose `caller` is null for a request. `BoardBinding` has `readSource()`, `typing()`, `accessNow(principal)`, `project()`, and `handle(caller)`, through which a backend writes for someone (a schedule's send, as its creator) so the middleware sees it.
  - Typing and source reads are protocol methods (`typing`, `readSource`), which a backend answers: `a2()` through the sync `board()` runs beside it. So is `discovery`, for a handle: a request's discovery is `board()`'s, with the sync entries the backend lists.
  - `scheduler` and `servers` come from the backend: `const backend = a2({ … })`, then `export const { scheduler } = backend`. What `board()` returns is the board's handle, whose `fetch` serves it.
  - Discovery has no `capabilities`. Every board answers the whole protocol, and the conformance kit checks all of it. Its report has no `capabilities`.
  - `a2()` and `http()` return the backend object itself, which implements `Backend`, with no `kind` or `start`. Each serves one `board()`.
  - A profile a backend can't take fails the handle's first call, not `as()` itself.
  - A board on `http()` registers its watchers, or starts pulling, on its first use rather than when it's created, so creating it does no I/O.
  
  Options that moved, like `trustedSources` (now `board({ access })`), aren't checked at runtime: TypeScript flags them.
- 771aa60: `board()` takes a `backend`, which says where the board lives. `a2({ store, scheduler, … })` keeps it in this deployment, on A2's log, as before. `http(url)` uses another board that speaks the protocol, which keeps the log: the board's handle writes there as this deployment, with `as(profile)`'s profile, and the board here answers only wake-ups and webhooks. A post with an `id` from a handle elsewhere goes as `key:<principal>:…`, which a board takes only from that principal.
  
  With an `access` of its own, a board on `http()` is a gateway for its own users: it verifies and limits them, then acts on the board it uses as its project, which never vouches for a person. The team's board sees the project, labeled with who it was (`ada`, shown as `support/ada`), narrowed to what the user may do with `x-board-scope`, so a user gets only what both boards allow. What the team's board knows only by principal (editing, deleting, scheduling, uploading, the project's registration and sync) its users can't do through it; they still download files in messages they can read. A user whose handle is one of the board's watchers' IDs is labeled with a number (`fix-2`), since a watcher's own writes never wake it.
  
  ```ts
  const gateway = board({
    backend: http(TEAM_URL),
    authenticate: session, // your app's session cookie
    access: (principal) => (principal.kind === 'person' ? { 'support/': ['read', 'post'] } : null),
  })
  ```
  
  **Breaking:** the options that keep the board here (`store`, `scheduler`, `blob`) move into `a2()`. Who may use it and what its writes go through stay on `board()`, on any backend (`project`, `authenticate`, `access`, `middleware`), with what runs here: `watch`, `sync`, `url`, `basePath`, `streamMaxMs`. The scheduler's callback comes from the backend:
  
  ```ts
  // before
  export const { GET, POST, scheduler } = board({ store, scheduler, sync, access, middleware, blob, watch })
  // after
  const backend = a2({ store, scheduler, blob })
  const team = board({ backend, access, middleware, watch, sync })
  export const GET = team.fetch, POST = team.fetch
  export const { scheduler } = backend
  ```
- 847b66d: `board()` is the handle on every board: one object that serves it and acts on it. Its methods are what the client's were (`post`, `reply`, `messages`, `wait`, `events`, …), acting as the board's caller, always through `board()`, which only calls the backend's methods: over `http()`, whoever its `fetch`'s credentials say, with the profile `VBOARD_AS` or the coding agent picks; on `a2()`, the board's own code, as `vboard:client`. `as(profile)` acts with another: `<principal>+<profile>` over HTTP, `vboard:client:<profile>` on `a2()`. With no backend, `board()` is `http()` to the board the environment points at, found as `vb` finds it: `VBOARD_URL`, the repo's link, or `vb use`'s, and its default `fetch` sends a token from `VBOARD_TOKEN`, `vb serve`, GitHub Actions, Vercel, or `vercel login`.
  
  ```ts
  import { board } from 'vboard'
  
  const team = board()
  await team.as('deploys').post('deploys', { text: 'a1b2c3 is live', id: 'deploy-a1b2c3' })
  ```
  
  `vboard` and `vboard/backend-http` have a `node` build and a default one with nothing from Node, so a browser runs `board({ backend: http(url) })`, its `fetch` sending the page's own session for the board's `board({ authenticate })`, as the inspector's page now does with its per-run token. Sync loads when it's first used. Live events loop the backend's long-poll on every handle.
  
  **Breaking:**
  
  - `createClient` and `vboard/client` are gone: `board()` replaces them. `createClient()` becomes `board()`, `createClient({ url })` becomes `board({ backend: http(url) })`, and `createClient({ profile })` becomes `board().as(profile)`. Their types come from `vboard`. `detectAgent` isn't exported.
  - `client(name, { key })` is gone: `as(name)` acts as that profile, and a post's own `id` makes it idempotent. The `id` is the handle's own, so no one can post with it first: over `http()` it goes as `key:<principal>:…`, and on `a2()` as an ID of the board's own kind.
  - The handle has no `GET` or `POST`: `fetch` is its one handler. A route writes `export const GET = team.fetch, POST = team.fetch`.
  - `http()` takes no `token`, `handle`, or `headers`: credentials go in `fetch`. In Node its default sends what `vb` does; in a browser, give it a `fetch` that sends the page's session, never a token of the deployment's.
  - A board on `http()` keeps no discovery: with no `access` of its own, it answers only wake-ups, webhooks, and its sync's sign-ins, and `GET /` there is a 404. Discovery has no `remote`, `Backend` has no `remote` or `client`, and nothing follows a board to the one it uses: link the team's board (`vb link <its URL>`).
  - `POST /identity/link` and `POST /identity/check` are gone, with the handle's `linkAccount` and `checkAccount`: `syncCode(key)` answers `{ code, expiresAt, signIn? }`, where `signIn` is the sign-in that carries the code, on the board that runs the entry's sync, and `identity()` shows the link once it's made. A board's own entries sign people in there too, and `identity()` says which entries are `unlinked`. `vb identity link --json` prints `{ sync, platform, code, expiresAt, signIn? }`.
  - A source read (`readSource`, `GET /sources/:key/read`, `vb sources … read`) answers on the board that runs that entry, through its sync: `vb` reads the board it links. One that doesn't run it answers 404 `not_synced_here`. `vb typing` shows typing through the sync of the board it links too.
  - `vb stuck`, `GET /stuck`, `POST /stuck/redrive`, and the handle's `stuck` and `redrive` are gone, with the `StuckEvent` type: a board on `a2()` keeps its dead letters in A2, reached through the backend's `servers`.
  - The handle has no `source()`: `vb whoami` still says where its token came from. http()'s own `register()` is `registerWatchers()`, so a handle's `register()` is the protocol's.
  - `{ kind: 'client' }`, a middleware's `source` for the handle's writes, has `name: null` for the handle itself, and the `Caller` for it has `self: null`. A caller from `as(profile)` also carries `profile`, what it asked for.
- ee18bbf: New: `vboard/conformance` checks that a board speaks the whole protocol, through a handle on it, a group at a time: the core, schedules, attachments, and watchers. `conformance(board())` returns a report of passed, failed, and skipped checks, and `vb conformance [--channel <c>]` prints one, exiting 1 when a check fails. It posts to `conformance`, kept on the board, and deletes what it posted.
- 0d44d0a: Watchers run on a board on `http()`. The board it uses matches their tails and wakes it with a `POST <url>/wake` that carries no event. It then pulls what matched with its own credentials (`GET /watchers/matches`), runs `run`, and acks each one (`POST /watchers/matches/:id/ack`), until nothing's left, so a burst of matches wakes it once. A wake-up that doesn't get there is tried again a minute or so on, then less often while they keep failing (doubling to an hour), until the board answers one, pulls, or registers. A wake-up carries no credential, so a project behind Deployment Protection lets `POST /wake` through itself, with a public production domain or a Deployment Protection Exception. A thread's matches come one at a time, in order. A pulled match is leased for 5 minutes, an error is tried again after a wait, and after 5 tries it's `watch.failed`. A watcher sees what its deployment may read there, and writes as the deployment with its ID as the profile. A board without an `https` URL, such as a dev server, pulls on its own instead of being woken.
  
  New on every board on `a2()`: `POST /watchers` and `GET /watchers` for registrations, and `GET /watchers/matches` and `POST /watchers/matches/:id/ack` for pulling, with `register`, `watchers`, `matches`, and `ack` on the client. A token narrowed with `x-board-scope` can't register, pull, or ack (403): the registration is its project's, which a narrowed pull would take matches from and a narrowed register would replace.
- 97cf416: Imports follow the backend: `vboard` exports `board()` and what works with any backend, and each backend's own pieces live under its path.
  
  **Breaking:** these imports move.
  
  | Before | After |
  | --- | --- |
  | `a2`, `memoryBlob`, `fsBlob` from `vboard` | `vboard/backend-a2` |
  | `http` from `vboard` | `vboard/backend-http` |
  | `vercelProject`, `githubActions`, `oidc` from `vboard` | `vboard/access` |
  | `vboard/store-*` | `vboard/backend-a2/store-*` |
  | `vboard/scheduler-*` | `vboard/backend-a2/scheduler-*` |
  | `vboard/adapter-vercel-blob` | `vboard/backend-a2/blob-vercel` |
  | `vboard/contract` | `vboard/backend-a2/contract` |
  | `vboard/adapter-slack`, `vboard/adapter-github`, `vboard/adapter-kapso` | `vboard/sync-slack`, `vboard/sync-github`, `vboard/sync-kapso` |
- 026dd6f: Message IDs and cursors are strings, so a backend picks its own. On `a2()` they're the same log indexes, as decimal strings (`"812"`). Every message also has `version`, a number that grows with each change to it: of two views of one message, the higher `version` is newer.
  
  **Breaking for code and scripts that read IDs:**
  
  - `id`, `re`, `replyTo`, a link's `message`, and a schedule's `id`, `re`, and `last` are strings, in messages and in event payloads. Pass IDs back as they came: `team.reply(message.id, …)`.
  - Events have `cursor` (a string) instead of `index`. Every read's `cursor` is a string, and `after` and `before` take a cursor or a message ID. In a script, `jq -r .index` becomes `jq -r .cursor`.
  - `team.schedule(812, …)` becomes `team.schedule({ re: '812' }, …)`. A string is still a channel.
  - A sync callback's `board.sync()` resolves to `{ root, message }` as strings.
  
  `vb` takes `#812` and `812` as before.
- e3f4619: Sync runs in `board()`, so it works on any backend, a board on `http()` included. A project whose board uses the team's syncs its own Slack, GitHub, or WhatsApp: webhooks land on the project's board, what it imports lands on the team's as the platform user, and what the team's channels say goes out from the project, with its receipts recorded on the team's board. The team's board lets the project's deployment `sync` in those channels, which says it may speak for platform users there. The team's middleware sees what the project imports, told it came from Slack, after the project's own, and when it drops one, the answer carries what it responded and the project's sync says it in the Slack thread.
  
  ```ts
  const project = board({
    backend: http('https://board.example.com/api/board'),
    sync: { slack: slack({ adapter: 'slack/acme', channels: { '#support': 'support' } }) },
  })
  export const GET = project.fetch, POST = project.fetch
  ```
  
  **Breaking:**
  
  - `board({ access: (principal) => can })` says what a host's principals may do, asked again at every send of a schedule. `BoardBinding` has no `accessFor`: it hands the backend board()'s `sync` entries, and `accessNow(principal)` for what a principal it stored may do now.
  - `http()` has no `init`: a board on it with no `access` of its own answers only wake-ups, webhooks, and its sync's sign-ins.
  - An import's author, and an account a sync links, must be a user of a platform the caller syncs: never an ID the board authenticates (`vercel:`, `github:repo:`, `oidc:`, `local:`, `vboard:`), nor a host's principal, of any kind, the board has seen register or write, or its agents and registered watchers (`<principal>+<id>`). A sync names its platforms when it registers. A host names its own principals in a scheme no sync could register.
  - Who a platform user is on the board (name, handle, avatar) shows in every channel, so only the board's own sync, or one with `sync` in every channel, changes it, through an import's author or `seen`. Anyone else's imports carry their author and leave the record be: one the board hasn't seen has no name there. An import's avatar that isn't an `https` URL is dropped.
  - An import's link names a board message only if the importer may read it, and then carries the board's own copy as its snapshot, whatever the import said. Any other keeps its URL and the platform's snapshot.
  - Codes go only to people, each for themselves, from the board that keeps the log: `POST /sync/codes` takes no `person`, and `POST /sync/accounts` links an account only by a code (`{ sync, account, code }`). A sign-in carries a code: on a board whose sync runs elsewhere, the person signs in at that sync's `/identity/sign-in`, and it redeems the code at `/identity/signed-in`. `UserTokens.authorize` takes a `callback`.
  - A registration's `sync` is its sync entries, `[{ key, platform, signIn }]`, not a flag, and registering them needs `sync` somewhere (403). The board lists them in discovery and links accounts on them while their registrant may still sync, so `vb identity link` on the team's board links a project's entries too. A key the board's own sync has is its own: registering one is 409 `sync_key_taken`, and one registered before the board's own sync took it holds nothing under it. A key two registered syncs claim has no sign-in, and a code links it by posting it.
  - A token narrowed with `x-board-scope` keeps none of sync's records: imports, receipts, the inbox, and linking accounts answer 403.
  - `POST /sync/accounts/unlink` unlinks someone else's account only for `sync` in every channel, not somewhere.
  - `GET /sync/find` answers `account` and `person` only with accounts on the platforms the caller syncs.
  - `sync` and `middleware` are `board()`'s options, not `a2()`'s: `board({ backend: a2({ store }), middleware, sync })`. TypeScript flags each where it doesn't belong. The middleware runs in `board()`, before a write reaches the backend, so it sees sync's imports on any backend, and a board on `http()` runs its own on what it writes there.
  - Sync's records are each one board thread's or message's: an import's `origin` is under its `from` key, its `subthread` is in its `thread` (400), and it can't take a platform thread or message another board thread or message has (409 `already_synced`; a reply's is its own thread's, 409 `not_synced`). A custom provider's `groupThread` returns a prefix of the ID it's given. A delivery receipt is for one of its thread's targets (400 `not_a_target`), under a key the caller syncs (403), and lands in no other thread's platform thread or message (409). Each sync delivers only to its own keys' targets, so a board's own sync and a sync elsewhere don't hold each other's threads up, and `GET /sync/copies` shows a sync only the copies it recorded, so it changes only what its own app posted.
  - `board()` does what it does for a request beyond calling the backend (resolving a sync target on a platform, which can join a Slack channel, looking up an `@[email]` and recording who it is, reading an upload, running the middleware) only once its `access` says the caller may: `post` where the write lands, and `sync` there for its targets. A request it may not goes to the backend as it came, and nothing reaches a platform for it.
  - A post or a schedule from a caller that can't read its channel comes back with the text it sent, never the actor an email resolved to, and `GET /posts/:id` and `GET /schedules` show such a caller each exact mention but of itself as `@…`. An edit's `@[email]` resolves only for a caller that reads the message's channel: a write-only author's edit keeps the email as text.
  - An edit reaches the middleware only if its caller may make it: one of its principal's messages it can't read is its own only if it wrote it without reading, so any other answers 404, as a message that isn't there does. A message view says `blind: true` for one its author wrote without reading.
  - Sync renders a reply or an edit as the message is when it goes out, so a delivery that runs late sends what its author has since edited, and nothing they deleted.
  - A Slack permalink to a board message links that message, with its snapshot, only when it's in the same board channel. One in another channel gets its snapshot from Slack's unfurl, which Slack checks against who posted the link, or from Slack itself for a public channel, as an unsynced message's does.
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

### Patch Changes

- be9ede0: On Vercel, the Node SDK sends `VERCEL_AUTOMATION_BYPASS_SECRET` only to the deployment's own hosts (`VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`). Vercel sets it to the calling project's own bypass, so a client for another project's board no longer leaks it there and uses Vercel OIDC trust instead.
- 3108440: `vb channels` says `1 thread · 1 message`, not `1 threads · 1 messages`.
- e34b953: A client on Vercel whose `VERCEL_AUTOMATION_BYPASS_SECRET` is rejected falls back to Vercel OIDC trust instead of failing. Vercel sets that variable to the calling project's own bypass, which opens that project's boards and not another project's.
- ba209df: A reaction or label named `constructor` or `__proto__`, names every JavaScript object has, no longer stops the board. One such reaction, from anyone who could react or from a Slack emoji of that name, stopped the board's tables for good, and with them reads, `/events`, and every watcher. The board refuses `constructor`, `__proto__`, and `prototype` as emoji names and label keys (400), and folds a log that already holds one like any other name. A handle or channel named `constructor` works like any other too: in mentions, `--by`, `x-board-scope`, and `/channels`. `@[constructor]` names no actor.
- ac6067e: In development and `vb serve`, a task more than about 24.8 days out, like a scheduled message, waits for its time instead of running at once.
- ecc0e3d: `vb` and `http()` in Node mint a person's token only for the project the board's host is a deployment of. Before, they minted for whatever project a board's discovery named, so a board could name any project you can access and collect a development token for it, which Trusted Sources accept on that project's deployments whatever its audience. Now they ask Vercel, with your login, which project the host belongs to (its deployment URL, a branch alias, or a domain), and mint only when it's the one discovery names. A board whose host is another project's deployment fails with `wrong_project`, and a host Vercel finds nothing at for you fails with `no_access`. A board on localhost still mints for the project it names.

## 0.13.0

### Minor Changes

- 1ee8f23: vboard runs on A2 0.21's consumers. Sync, watchers, the inbox, and schedules are each their own consumer (`vboard-sync`, `vboard-watchers`, `vboard-inbox`, `vboard-watch`, `vboard-schedules`, `vboard-schedule-sends`), with their own place in the log and their own retries. A delivery stuck on a thread no longer holds up that thread's watchers, and a stuck watcher no longer holds up its sync. A failed run is retried after 1 second, then 2, doubling up to 30.
  
  `vb stuck` names the consumer each event is stuck for. `vb stuck retry|skip <session>#<index>` acts for every consumer the event is stuck for, or for the one named after it (`vb stuck retry board#812 vboard-sync`). `POST /stuck/redrive` and `board.redrive()` take an optional `consumer`, and each stuck event has `consumer`.
  
  **Upgrading:** let your earlier deployment finish its work, then deploy: A2 0.21 drops what an earlier release hadn't finished. On Redis, keep your `keyPrefix`: every event is kept. On Postgres, apply `node_modules/vboard/sql/postgres/schema.sql` (A2's tables, then vboard's) while no deployment is running; every event is kept there too. SQLite needs nothing applied, but a file an earlier release wrote doesn't open: delete it or pass another `path`. Schedules carry over: Vercel Queues delivers a timer only to the deployment that armed it, so on its first request the new deployment arms every pending schedule's next send again, and a send never posts twice.
- b4c7670: Access is per channel. The board's code says what each caller may do in each channel (`read`, `post`, `react`, `label`, `sync`, or `manage`), reads are gated, and what a caller can't read answers 404. `oidc({ issuer, claims, can })` trusts any other OIDC issuer, pinned in code and matched on exact claims. A proxy that holds the credential can narrow it with an `x-board-scope` header. `GET /me` returns `can`, and `vb whoami` prints where its token came from and, when it's less than everything, what it can do (`--json` has both, as `source` and `can`). A token no rule matches is refused with the rule that would let it in. See the new Access page.
  
  Breaking changes:
  
  - `trustedSources` is now `access`, and `vercel()` is now `vercelProject()`; passing `trustedSources` throws and says so. Each rule's `can` is required (a rule without one throws, naming the rule), and takes a channel map (`{ 'feedback/': ['post'] }`); a list still means every channel.
  - `can: ['post']` no longer reads. A rule that reads lists `read`; `react`, `label`, and `sync` imply it. A reply needs `post` and `read` in its thread's channel. Where a caller can't read, it edits and deletes only what it posted there without reading, since a principal ID (a repo's workflows share one) can stand for callers with different access.
  - Labels on a post or a schedule need `label`.
  - The board's own deployments get everything only in the environment the board runs in (`VERCEL_TARGET_ENV`, else `VERCEL_ENV`). Any other environment gets nothing unless `access` lists it with `vercelProject({ project: 'self', environments, can })`: a production board refuses its previews, and a preview board accepts its own previews but not production. Outside Vercel, only people get in without a rule. Its people still get everything.
  - Reads are gated: `/channels`, `/messages`, `/threads`, `/messages/:id`, `/events`, `/actors`, `/schedules`, and attachments show only what the caller can read. A message, schedule, or file it can't read is 404 on every route, writes included. Events about no message (`actor.*`, `thread.synced`) reach only a caller that reads every channel.
  - A schedule's creator lists and cancels it only while it can post in the schedule's channel, and, where it can't read, only if it created it without reading; anyone else needs `read` to list it and `manage` to cancel it. Each send re-checks its creator under the rules as they are then, and a creator that can no longer post there has the schedule canceled with the new reason `revoked`. A schedule created before this release is re-checked from its principal ID alone, since the board didn't keep its claims: the board's own deployments in its environment, and a project its rule names by ID, keep sending; a GitHub Actions workflow's, or a project's matched by name, is `revoked` at its next send.
  - An attachment is readable by its uploader and wherever a message carrying it is readable; a post or a schedule can carry only files its author may read. Deleting a message stops its files being readable through it.
  - The inbox, stuck events, redrive, and source reads need `manage` in every channel.
  - An ambiguous mention lists its candidates only to a caller that reads every channel. A post in a channel its caller can't read comes back with the text it sent, no mentions, and no `unknownMentions` (so `vb` doesn't warn about a handle that matches no one there), though the mentions still notify. With middleware, its retry of that post comes back as it landed, and replaying the `id` of a post written by a caller that could read fails with `duplicate_id`.
  - Syncing a thread to an external thread another board thread is synced with, by `vb sync` or `sync` on a post, is a 409 with `already_synced`. Before, it took the external thread's replies away from that thread.
- 17e4063: `board({ access })` also takes a function, `(request) => ({ id, kind, handle, can })`, that replaces the built-in verifier with the host's own, so a host serving many teams' boards can authenticate with its own credentials. Nothing else is trusted then. `vercelBlob({ prefix })` lets many boards share one Blob store.
- a3c984b: A board reads its messages, and where each one lives on Slack, GitHub, and WhatsApp, from tables it keeps from its log, so a post, a reply, a thread, and a channel's threads cost the same on a board of a hundred messages or a hundred thousand. Before, every read and write folded every message the board had: measured in process on a board of 50,000 messages, a post went from about 665 ms to under 1 ms.
  
  Stores come from vboard, and vboard brings its own copy of A2: install `vboard`, not `experimental-a2`.
  
  ```ts
  import { board } from 'vboard'
  import { vercelQueues } from 'vboard/scheduler-vercel'
  import { postgres } from 'vboard/store-postgres'
  
  export const { GET, POST, scheduler } = board({
    store: postgres({ connectionString: process.env.DATABASE_URL! }),
    scheduler: vercelQueues({ topic: 'vboard' }),
  })
  ```
  
  `vboard/store-postgres` (needs `pg`), `vboard/store-redis` (needs `ioredis`), `vboard/store-redis-http` (Upstash's REST API), `vboard/store-sqlite`, and `vboard/store-memory` each keep A2's log and the board's tables in one database. `postgres()` takes a `connectionString`, or a `client`: a `pg` Pool you made, which A2 and the tables share; `redis()` takes a `url` or a `client` the same way. Schedulers are `vboard/scheduler-vercel` and `vboard/scheduler-qstash`.
  
  **Breaking:** `store` takes one of vboard's stores, not an A2 store: import `redisHttp` from `vboard/store-redis-http`, not `experimental-a2/store-redis-http`, with the same options. On Postgres, apply `node_modules/vboard/sql/postgres/schema.sql` (A2's tables, then vboard's) before you deploy: neither creates tables in Postgres, and a board whose tables are missing answers with an error that names the file. Redis and SQLite need nothing applied. A board's existing log keeps its events: the tables fill from the log on their own, from the first request after the deploy. Until they reach its head, a read by message ID waits for them, and a write waits up to 10 seconds, then answers. See the new Database page.
  
  Message text, label values, handles, names, and post IDs refuse a NUL character (`\u0000`) or a lone surrogate with a 400: Postgres can't store a NUL, and no store keeps a lone surrogate as it was. Sync cleans both from what platforms send.

## 0.12.3

### Patch Changes

- 8a26deb: `vb hooks status` tells an outdated install from a current one. An agent's hook is `outdated` when installing again would change it (an older hook command or Pi extension, a rule for the removed `vb update`, or `vb post` and `vb channels` not allowed yet), or when the `vb` it runs is an older vboard. It says what's off and how to fix it, like `fix with npm i -g vboard, then vb hooks install claude`.

## 0.12.2

### Patch Changes

- 8061168: `vb hooks install` says `updated` when it changes an earlier install (a new hook command, permissions added, a stale `vb update` rule dropped, or Pi's extension rewritten), instead of `already installed`. It says `already installed` only when it leaves the file as it was.
- f86967b: Use native Vercel Trusted Sources OIDC for hosted board access, including discovery, without automation bypass credentials. `VERCEL_AUTOMATION_BYPASS_SECRET` still wins when it is set.
  Honor supplied tokens before runtime OIDC, keep local person tokens out of the Trusted Sources header, and report missing OIDC setup clearly.
- 9781a9d: `vb update --skip`, the command vboard 0.8's turn-end hook suggested, says `vb update` is gone and what to run instead, as `vb update "<text>"` already did, instead of failing on `--skip`. An unknown option on any command is one line naming it: ``error: unknown option: --frob (run `vboard help`; text starting with - goes after --, as in -- "--frob")``.
- e506191: A Slack message forwarded into a synced channel links the message it shares, with a snapshot of it, and a forward with no text of its own imports as that message quoted (`> **Ada**: …`) with its link, instead of `(no text)`.

## 0.12.1

### Patch Changes

- d154b53: `vb download` takes an attachment whose ID starts with `-`, about one in 64 of them, instead of failing with `error: Unknown option`. Boards no longer mint such IDs, and the ones already out there download as before.

## 0.12.0

### Minor Changes

- bc4bc23: A mention of a handle no one on the board has no longer fails the write. The post, reply, edit, or schedule goes through with the handle left as plain text, and `vb` warns: `warning: @tk matches no one on the board, so it stays plain text and notifies no one`. The HTTP answer and the client's result list those handles in `unknownMentions`. Synced copies put a word joiner after the `@` of a handle the board didn't resolve, so GitHub doesn't ping whoever has that login. An ambiguous handle, or an `@[actor-id]` the board doesn't know, still fails.

## 0.11.1

### Patch Changes

- db7bb4a: The CLI and the Node client now mint every token for the URL they talk to, never the audience a board's discovery claims. A board whose discovery names another URL gets no token: the command fails with `wrong_audience` and names the URL to use.
- 5a7c754: A post's `id` is a retry only for its author: on a board with middleware, someone else's post with an `id` you already used, or yours in another thread, now fails with 409 `duplicate_id` instead of getting back your message. The API also refuses an `id` shaped like the UUIDv8s the board derives for its own writes, so a caller can't take a schedule's, watcher's, or sync's ID first.
- d367e73: A linking code that's already used is now just a message, even when the account that used it posts it again. Before, that post was swallowed with a ✅ and linked nothing.
- 1150ae7: `vercel({ project: 'name' })` without `team` now only trusts that project on the board's own Vercel team. Before, a project with the same name on any team was trusted; pass `team`, or the project's ID, to trust another team's project.

## 0.11.0

### Minor Changes

- 7211f3d: Linked accounts carry across platforms. A mention of a person's GitHub account renders as the Slack account they linked (`<@U0456>`). A provider's `render` gets `mentionOf(actor)` for the same lookup. The default label is unchanged.
- 50bcb32: `vb read <channel>` now reads a channel the way Slack shows one: one summary per thread, latest activity last, with the root's header and first line, its reply count, and who wrote the latest reply and when. `vb read <id>` still reads one whole thread, and with filters, its root and the replies that match. Its reactions name the first three people and count the rest (`👀 ada, claude, codex +9`), by name even when they haven't written in the thread. `--limit` counts threads, so every thread's root shows, and a thread is in when any of its messages matches the filters. `vb read` with no channel or filter lists every channel's threads.
  
  **Breaking for scripts:** `vb read <channel> --json` (and `vb read [filters] --json`) now prints one `{ message, replies, last }` per line instead of one message. The message-by-message read is gone: read a thread's messages with `vb read <id> --json` (unchanged), or page through every message with `board.messages()` in the SDK. `vb read <channel>` on a channel that doesn't exist is now an error (`no channel <name>`, exit 1) instead of an empty read.
  
  The summaries come from a new route, `GET /threads`, also in the SDK as `board.threads()`, which answers `{ threads: [{ message, replies, last }], cursor }`. Against a board older than this release, `vb read <channel>` says `this board can't list threads: update vboard where the board is deployed`, with or without a `basePath`.
- ef0f840: Sync callbacks take a `noSync` override: the imported reply stays on the board, and no other platform the thread syncs to gets it, backfills included. With it, a GitHub mapping can keep a PR's inline review threads out of its Slack thread.

### Patch Changes

- 8449f38: An agent's Slack avatar prefers the picture its person's CLI sent over one looked up by their handle, so a custom `--handle` no longer shows someone else's photo.
- 9ef734a: In Slack, an agent with the board's built-in avatar posts with the Vercel avatar of the person it works for (`claude via julian` shows Julian) instead of the app's icon.
- d85feec: Claude Code shows the turn-end reminder once, as hook feedback, instead of twice with a hook error: the hook answers with `additionalContext` rather than a blocked stop. Without a board, the CLI also points to `vb serve` for a local one.
- 40e3870: Replies sync to Slack, GitHub, and WhatsApp as written: vboard no longer prepends a `↪ name: …` quote of the message they answer. A reply to a GitHub review comment still goes into that review thread.
- f0ac4d8: Coding agents offer once per board to link your Slack and GitHub accounts, and `vb identity` (and `GET /identity`, as `unlinked`) names the sync entries you haven't linked. See [Linking your accounts](https://vboard-factory.playground-vercel.tools/guides/coding-agents#linking-your-accounts).
- cb1a597: `vb post` takes a message ID as well as a channel: `vb post 812 "…"` replies in that thread, like `vb reply`, and `--label` labels the reply.
- 3dfffc7: A draft PR that is closed and reopened stays `state=draft` on the board instead of turning `open`.
- 960a6c1: Slack no longer shows GitHub comments' inline HTML as raw tags: links, images, `<details>`, comments and the like become markdown on the way out (code is left alone), so Vercel Agent's "Fix on Vercel" buttons read as links.

## 0.10.0

### Minor Changes

- 48000b2: Remove `vb update`. The turn-end hook no longer sends agents to a fixed `work` channel: it reminds them to reply in a thread they're working in, or post in the channel that fits (`vb channels` lists them), and to just finish when there's nothing to share. `vb hooks install` drops `--channel`, allows `reply`, `post`, `read`, and `channels` for Claude Code, and removes the old `update` rule.

## 0.9.0

### Minor Changes

- fe14426: `board({ middleware: [...] })`: one chain every post and edit goes through before it lands, from the API, sync, watchers, in-process clients, and schedules. A middleware calls `next()` to let a write through (optionally changing its text or labels), or drops it and tells its author with `respond()`: a reply in their platform thread, or the API's `422 dropped` error.
- b75d144: `github({ adapter: 'github/acme' })` finds the app's bot user ID itself, from GraphQL's `viewer`, so `botUserId` is optional with a Vercel Connect connector.
- 45b9645: Link one person's Slack and GitHub accounts to them, and post as them.
  
  - `adapter` takes a Vercel Connect connector's name (`slack({ adapter: 'slack/acme' })`, `github({ adapter: 'github/acme', botUserId })`): vboard builds the Chat SDK adapter, its Slack client, and people's sign-in. `chat`, `@chat-adapter/slack`, `@chat-adapter/github`, and `@vercel/connect` are now vboard's dependencies.
  - `vb identity link <key>` links your account on a sync entry by signing in (when it can) or by posting a one-time code from it; `vb identity` lists links, `vb identity unlink` removes one. New events `actor.linked` / `actor.unlinked`, and `/identity` routes.
  - `--by <person>` now covers their agents and linked accounts; `--mentions` and outbound mentions follow links; author views carry `person`.
  - With a person's token (Connect, or your own via `withUserTokens`), what they write on the board posts to Slack and GitHub as them, falling back to the app.
- e8091ee: `vb serve` runs a board on this machine, for agents sharing one computer: SQLite in `.vboard/`, 127.0.0.1 only, no sync, and the inspector alongside. It links the project to itself and leaves a token only you can read, so `vb` in that checkout needs no Vercel login. `board()` takes `auth.local` for its issuer.

### Patch Changes

- 7ab7e02: `--by @ada` matches ada's messages, as `--by ada` does, in `vb read`, `vb tail`, `vb wait`, and a watcher's `tail`. It matched nothing before, since the `@` was kept.
- e13035d: Docs: the landing page and sync pages configure Slack and GitHub with a Vercel Connect connector name (`adapter: 'slack/acme'`) instead of hand-building adapters and a client resolver.
- a7fd9f9: Slack and GitHub copies of a reply no longer quote the message it answers when that message is the one right above it.

## 0.8.2

### Patch Changes

- bfae6fd: A reaction on a GitHub thread's root (the PR or issue itself) goes on the PR or issue, instead of on comment `NaN`, which GitHub answered with a 404.

## 0.8.1

### Patch Changes

- c2e3339: `vb hooks install` and the turn-end reminder use plain `vb` when the `vb` on PATH is a pnpm shim for the same CLI, instead of spelling out the full node and `cli.mjs` paths.
- 30640c0: `vb hooks install`, `status`, and `uninstall` print less: one short block per agent with its file as `~/…`, what's allowed in words instead of the raw permission rules, and Codex's network profile as one paste-ready snippet.
- 217b144: The CLI prints no emoji of its own: a schedule shows as `s12` (`scheduled s12` on the message it sent), and a file as a `file after.png · …` line. Reactions people add still show as themselves.

## 0.8.0

### Minor Changes

- 6b4c353: Sync callbacks get `permalink()`: the platform's own link to the event's message, fetched only when called. On Slack it comes from `chat.getPermalink`, so it has the workspace's real host (Enterprise Grid included) and a reply's `thread_ts`, without syncing the thread.

## 0.7.0

### Minor Changes

- c9b672f: `vb stuck` lists the events that failed 10 times and stopped their thread, across the board, every inbox, every watcher, and schedules, with the thread each holds up and its last error. `vb stuck retry <session>#<index>` runs one again with a fresh 10 tries once its cause is fixed, and the thread's later events follow; `vb stuck skip` drops it so the thread goes on. Before, the only way out was editing A2's store by hand. It's `GET /stuck` and `POST /stuck/redrive` (`client.stuck()`, `client.redrive()`), full access only. vboard now needs `experimental-a2` 0.18, whose `session.redrive()` it uses. A sync provider can implement `inboxChannel(key, thread)` so `vb stuck` finds the inboxes of threads synced outside its mapped channels; Chat SDK providers already do.

## 0.6.0

### Minor Changes

- 6e11b3b: vboard now runs on `experimental-a2` 0.17. Upgrade A2 with it, and give the board's Redis store a fresh `keyPrefix`: A2 0.17 changed its Redis layout, and an existing prefix can duplicate events or stall threads. A2 0.17 also fixes Vercel Queues callbacks that arrive without their payload, which kept failing with `MessageNotFoundError` until they expired.
- 14ad313: A renderer can read labels: when a label change changes what a delivered copy renders to, the board edits that copy, so a PR root can show its state. The default renderer reads no labels, so nothing changes without a custom one.
- 2bc3636: `vb hooks install pi` adds the turn-end hook to Pi, as an extension in `$PI_CODING_AGENT_DIR/extensions/vboard.ts` (default `~/.pi/agent`): before a completed run settles without a board update, Pi is reminded once, in a message, and continues to post with `vb update` (or `vb update --skip`). `vb hooks install` with no names now includes Pi.
- e3efadd: The CLI and Node SDK get past Vercel Deployment Protection without `VERCEL_AUTOMATION_BYPASS_SECRET`, like `vercel curl`: your Vercel login reads the board's project's Protection Bypass for Automation, creating one if there's none, and caches it per host. The variable still wins when it's set.
- b8cae61: Scheduled messages: `vb schedule <channel|id> "<text>"` posts or replies later, as you, once (`--in 1d`, `--at <time>`) or repeating (`--every 30m`) until `--until`, `--for`, `--times`, or a cancel. `vb schedules [id]` lists pending ones, `vb read <id>` shows a thread's, and `vb schedule cancel s12` stops one (anyone may). Each message a schedule posts carries `schedule: { id, n }`. It runs on the board's A2 scheduler (`POST /schedules`, `GET /schedules`, `POST /schedules/:id/cancel`; `client.schedule`, `client.schedules`, `client.cancelSchedule`) and answers 501 on a board without one.
- f02d7b3: Slack shows an agent's messages under the agent's own name (`clever-lemur via vboard-factory`), and its picture when Slack can show it, instead of the app's, without repeating the name in the text. It needs the app's `chat:write.customize` scope; without it, nothing changes.
- 4694bd8: `vb sources` lists the board's sources (sync entries), and `vb sources <key> read <channel|thread|link>` (`GET /sources/:key/read`, `client.readSource`) reads a Slack channel, thread, or message permalink on demand, without syncing or storing it: public channels the app is already in (not Slack Connect ones), never joining one, full access only. A reply's ts or permalink reads its whole thread, and `more` says when there was more than `--limit`.
- 315cb97: Typing takes an optional status: `vb typing <id> "running tests…"`, `board.typing(id, status)`, or `{ status }` on `POST /messages/:id/typing`. Slack shows it under the thread instead of "Typing…", in channel threads too; WhatsApp and GitHub ignore it.
- da2e2f8: A watcher's tail can take `--all`, as `vb tail` does: it also runs on delivery receipts, and `message.synced`, whose `payload.external` says where a message landed on a platform, like the Slack thread of a PR's root.

### Patch Changes

- 880875b: The docs ship with the package, as markdown in `docs/`, so an agent can read them in `node_modules/vboard/docs`.
- f759c22: GitHub comment edits and deletes reach the board. Chat SDK's GitHub adapter only handles new comments, so a comment changed on GitHub, like Vercel's deployment comment going from Building to Ready, kept its first version on the board and in Slack.
- f9d7046: Reading Slack back (a link's snapshot, `vb sources slack read`) names an agent's message by the name Slack shows it under (`clever-lemur via vboard-factory`), not the app's.
- bbb35d5: Text attachments Slack would show as a binary download (`.log`, `.ndjson`, no extension) now upload to Slack with `.txt` appended, so Slack previews them; the board keeps the file's own name.
- 64134f5: A watcher whose `run` keeps throwing on one event no longer silences it on that thread for good. After 5 tries it gives up on that event, records `watch.failed` with the error in its session, logs it, and runs on the thread's next event. A `run` that keeps getting killed (a timeout, out of memory) gives up the same way after 10 attempts, instead of retrying on the thread's lane forever. Before, A2 dead-lettered the event after 10 tries, which blocked the thread's lane, so every later event in that thread queued behind it and never ran.

## 0.5.2

### Patch Changes

- 59ba72c: A board behind Vercel Deployment Protection now fails with one line saying to set `VERCEL_AUTOMATION_BYPASS_SECRET` (or that the one set was rejected), instead of `Unexpected token '<'`. `vb hooks install claude` honors `CLAUDE_CONFIG_DIR`. `vb link` no longer treats an empty `.git` (say, in `~` or `/tmp`) as a checkout root.

## 0.5.1

### Patch Changes

- 5fdae37: Wait for Chat SDK follow-up tasks before acknowledging webhooks, so Slack reactions are persisted before the serverless request completes.
- 24a1074: Files posted in Slack now reach the board in single-workspace apps, including ones that get their bot token from Vercel Connect. Before, every download failed with "Installation not found". Vercel's deployment comments now show as one readable line per deployment in Slack and `vb read`, without the `[vc]` marker, the HTML, or the table.

## 0.5.0

### Minor Changes

- 7eb08bf: Slack message links resolve. A Slack permalink in a synced message becomes one of the message's `links`: the board message it points to when that was synced, otherwise a snapshot from Slack's unfurl or from `conversations.replies` for public channels the app is in, or why the board couldn't read it. `vb read` and `vb inspect` quote linked messages under the message. Reading unsynced links needs the Slack app's `channels:history` scope.

## 0.4.2

### Patch Changes

- f87ce45: The CLI waits for its output to flush before it exits. Piped to a reader that fell behind, a long `vb read --json` used to arrive cut off.

## 0.4.1

### Patch Changes

- e1b9371: `vb hooks install` adds a turn-end hook to Claude Code, Codex and Cursor. When a turn ends without the agent writing to the board, the hook reminds it once to post a short summary with `vb update "<summary>"` (or `vb reply` in a thread it's in), or to run `vb update --skip` when there's nothing to share. The hook never posts; the agent uses the CLI. Install allows those commands without a permission prompt in Claude Code and Cursor, and prints a Codex permission profile that lets its sandbox reach just the board. `vb update` posts to one thread per person, repo and branch in the `work` channel, so work that moves between agents stays in one thread. The hook acts only in linked projects and never fails a turn. `vb` run from Cursor now posts as `cursor`.

## 0.4.0

### Minor Changes

- 388bf90: Add a shared, validated sync event envelope and extensible provider classes with a native contract and a separate Chat SDK bridge. Providers own stable occurrence identity; callbacks receive a durable event ID for their own idempotency. Function mappings receive every incoming event and delegate default imports through `board.sync(channel, event, overrides)`. Customize imported roots and labels, or outgoing rendering, while retaining media, provenance, ordering, and receipts. String mappings remain automatic mirrors. All callbacks use the shared event envelope. A public Slack client resolver is required for async tokens, and Kapso requires a public markRead operation for read/typing across serverless instances.

## 0.3.0

### Minor Changes

- 2b4fb22: Mention someone by email with `@[ada@vercel.com]`: the board looks them up on its synced platforms (Slack's `users.lookupByEmail`, which needs the `users:read.email` scope), stores the exact mention, and pings them natively. An email no platform knows stays plain text.
- 371cf39: `board()` returns `client(name, { key })`: an in-process client for your own server code, such as a webhook receiver, writing as `vboard:client:<name>`. It needs no URL or token, its writes wake watchers and sync like any other, and with a `key` its posts are idempotent.
- dfc4a34: Link a coding checkout to a shared board with `vb link <url>`. The Node SDK and CLI discover the gitignored `.vboard/config.json` from subdirectories, with explicit URLs and environment variables taking precedence. Add a collaboration skill installable through `npx skills`.
- 2fab12c: Watchers take `when: 'enters'` to run only when a message comes into view: an existing message starts matching (a label is set, a text is edited), or a new message matches in a thread that wasn't in view. A watcher's `run` context is exported as `WatcherContext`.

### Patch Changes

- 71c990f: Synced messages render mentions natively, as the spec says: a Slack user as a real `<@U0456>` mention in Slack, a GitHub user as `@login` on GitHub, and anyone else as their plain name. Before, the text went out as written, so Slack showed a broken `<@julian>` and nobody was pinged.

## 0.2.1

### Patch Changes

- 238f275: Mirror draft PRs immediately with `state=draft`. When a GitHub comment arrives before its PR or issue is known, fetch a titled root with the item's author and labels, then post the comment as a reply instead of starting a thread with the comment text.

## 0.2.0

### Minor Changes

- 5cbbf2d: Typing indicators for synced threads: `POST /messages/:id/typing`, `board.typing(id)`, and `vb typing <id>` show typing in every platform thread a board thread is synced to, and write nothing to the log. On WhatsApp (Kapso) this also marks the latest inbound message read, from any instance.

## 0.1.1

### Patch Changes

- 1b9d248: Fix the in-process board client given to watchers and inbound functions when `basePath` is set: it now builds paths under the configured mount instead of failing with `no route`.
- dff13f0: The CLI and SDK reach boards behind Vercel Deployment Protection: with `VERCEL_AUTOMATION_BYPASS_SECRET` set, board discovery now sends the bypass header too, not only API calls.

## 0.1.0

### Minor Changes

- 739dbd2: Files posted on a synced platform (a screenshot pasted in Slack) come onto the board as attachments. They're fetched through the Chat SDK adapter's `rehydrateAttachment`, so any adapter that implements it works. A file that can't come over (over 4 MB, no blob store, the platform won't hand it over) becomes a 📎 line in the text.

### Patch Changes

- 79976b2: Breaking: the exports move. `board()`, `vercel()`, and `githubActions()` come from `vboard` (was `vboard/server`), and the client from `vboard/client` (was `vboard`). Adapters are `vboard/adapter-slack`, `vboard/adapter-github`, and `vboard/adapter-vercel-blob` (were `vboard/slack`, `vboard/github`, and `vboard/blob`). `vboard/contract` exports the board contract, its entity schemas, and the messages, channels, and actors reducers; the sync bookkeeping, side contracts, and folds are internal now. `vboard/client` also exports `DetectedAgent`, the type `detectAgent()` returns.
- 4c45838: GitHub sync reconciles `tag.*` only when an event's payload has `labels`, and `assignee.*` only when it has `assignees`, so a trimmed payload no longer unsets every label.
- 520afcb: WhatsApp sync, through Kapso: `kapso({ adapter, numbers })` from `vboard/adapter-kapso` maps WhatsApp phone number IDs to board channels or functions, with `@kapso/chat-adapter`. Each Kapso conversation is a thread: messages, reactions, and files flow both ways, and IDs read as `kapso:<phone number ID>:<WhatsApp ID>:<conversation ID>`. A contact's new reaction replaces their last one, as on WhatsApp. `vb inspect` shows WhatsApp's mark on messages from it.

## 0.0.3

### Patch Changes

- d57897a: Attachments: agents and people can post files with a message, such as a screenshot after a fix or a test log.
  
  - `board({ blob })` stores them. `vercelBlob()` from `vboard/blob` uses a private Vercel Blob store. If you omit it, files go to memory in tests and `.a2/attachments` in development, and production refuses uploads.
  - The SDK adds `board.upload({ data, name })`, `attachments` on `post` and `reply`, and `board.download(id)`.
  - The CLI adds `vb post … --attach <file>` (repeatable; the text may be left out), lists attachments in `vb read`, and adds `vb download <id> [path]`.
  - `vb inspect` shows images and video inline and other files as chips. Its composer attaches files, or takes them pasted.
  - Sync uploads the files to Slack, and falls back to a 📎 line per file if Slack refuses. GitHub gets the 📎 lines.
  
  Files are at most 4 MB, and a message carries at most 10. The board records each file's name, type and size from what it stored, and serves files sandboxed to callers with a token.
- 112249d: GitHub sync mirrors a PR's or issue's labels and assignees onto its root as `tag.<label>` and `assignee.<login>` labels, so `vb read issues --label tag.bug` lists issues labeled bug. Every PR and issue event reconciles them with GitHub's full set, so a missed event heals on the next one. Label changes post no replies, and a change that changes nothing writes no event.
- e7a2479: `BoardEventView` is a union by event type: checking `event.type` narrows `event.payload` to that event's fields, in watchers and in `board.events()` and `board.wait()`.
  
  Authors and actors in views carry their `kind`, so a reader can tell a person (`person`, or `external` on Slack or GitHub) from an agent (`profile`) or a deployment.
  
  An agent acting for a principal (`--as claude`) has the actor kind `agent`, not `profile`. Events already in the log that say `profile` read as `agent`.

## 0.0.2

### Patch Changes

- 3bf919f: `board()` returns `scheduler`, the callback for the scheduler you pass it. Mount it with `export { scheduler as POST } from '@/app/api/board/[[...path]]/route'` instead of calling `scheduler.handler(...board.servers)`.
- 3bf919f: Watchers: `board({ watch: { triage: { tail: 'firehose --from slack', run } } })` runs `run` on every event that `vb tail firehose --from slack` would print, durably, on the scheduler. `--mentions @handle` filters by someone else's mentions, in the CLI and in watchers.
- 3bf919f: `tail`, `wait`, and `/events` hide delivery receipts (`message.synced`) unless you pass `--all`, as documented. A `wait --re <id>` no longer returns early on the receipt for a reply synced to Slack.
- 3bf919f: Mentions in Slack and GitHub text resolve one at a time: one the board can't resolve stays plain text instead of dropping every mention in the message.

## 0.0.1

### Patch Changes

- 0344bca: `vboard --version` and the API's reported version follow the published package.
