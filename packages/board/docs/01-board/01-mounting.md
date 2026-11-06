---
title: Mounting
description: "`board()` is your team's board in Vercel's API. With a backend it's any other: `local()` keeps one in this process, `http()` uses one at a URL, and any object that answers the protocol works. What it returns is the handle: it serves the board and acts on it."
---

## One route

```package-install
npm i @vercel/board
```

```ts app/api/board/[[...path]]/route.ts
import { board } from '@vercel/board'

export const team = board()
export const GET = team.fetch, POST = team.fetch
```

That's your team's board, in Vercel's API. The board lives there, so this
deployment keeps nothing: people and the CLI use it in Vercel's API, and `vb`
finds it in any linked project. The route answers what Vercel's API sends this
deployment, the wake-ups that run its [watchers](./06-watchers.md). With an
`access` of its own, it also serves its own callers, as a
[gateway](./09-access.md#a-gateway). `fetch` is its one handler; Next.js wants
it under each method's name. Call `board()` once, at module scope.

Code that only acts on the board needs no route: `board()` in a script or a
function is the same handle (see [The handle](#the-handle)). A team has boards
of its own, each with a name: see [A board by its name](#a-board-by-its-name).

## Backends

`backend` says where the board lives:

| Backend | What it does |
| --- | --- |
| none | Your team's board in Vercel's API, the one `name` names. In Node with `BOARD_URL` set, `http()` to the board at that URL instead |
| `local()` | Keeps the board in this process, in SQLite under `.board/` or in memory: for development, `vb serve`, tests, and working offline. See [Local boards](./10-local.md) |
| `http(url)` | Uses the board at `url`, which keeps the log. This project reads and writes it as itself |
| your own | Any object that answers the protocol: see [A backend of your own](#a-backend-of-your-own) |

`vercel()` from `@vercel/board/backend-vercel` is the default by its name, with
options of its own: `team`, `board` (a board by its ID), `api`, `fetch`, and
`files`.

`board()` does the same on every backend. It routes and validates each
request, verifies its caller, applies [`access`](./09-access.md), runs the
[middleware](./08-middleware.md), and calls the backend's method for that
route with the caller it verified and the parsed input. Who may use the board
and what its writes go through are `board()`'s, so the policy is in one place
on any backend, and the backend stores. SSE, [the handle](#the-handle),
[watchers](./06-watchers.md), and [sync](../02-sync/01-overview.md) are
`board()`'s too.

### Vercel's board

`board()` with no backend keeps nothing here:

- **Vercel's API keeps the board:** messages, threads, reactions, labels, a
  channel's changes, schedules, and files, up to 100 MB each as a
  [direct upload](../04-reference/03-http.md#direct-uploads).
- **Its watchers run here.** Vercel's API matches each event against their
  tails and wakes this route when one matches: see
  [Watchers](./06-watchers.md#woken-by-the-board).
- **It doesn't run sync yet.** `board({ sync })` throws when it's created: a
  board with `sync` runs on [`local()`](./10-local.md), in a long-running
  process.
- **It acts as this deployment, or as you.** In a Vercel deployment it sends
  the deployment's OIDC token and writes as its project,
  `vercel:project:prj_x:production`. Elsewhere it sends `VERCEL_TOKEN`, or
  your Vercel CLI login, and writes as you. `fetch` sends other credentials.
- **What Vercel's API doesn't keep yet answers 501 `not_supported`:** files on
  a scheduled message, labels on a scheduled reply, and a post's `sync`
  targets. Grants and board tokens go to Vercel's API, which doesn't keep them
  yet. A channel's message and thread counts are left out.

### A board on `http()`

```ts app/api/board/[[...path]]/route.ts
import { board } from '@vercel/board'
import { http } from '@vercel/board/backend-http'

export const team = board({ backend: http('https://board.example.com/api/board') })
export const GET = team.fetch, POST = team.fetch
```

A board on `http()` keeps nothing:

- **It answers only wake-ups and webhooks.** Anything else, discovery
  included, answers 404 `<its URL>
  answers only wake-ups and webhooks`, and verifies nothing. People and the
  CLI use the other board, by its URL. With an
  `access` of its own, it serves its callers too, as a gateway: see
  [A gateway](./09-access.md#a-gateway).
- **Its handle writes there as this deployment:**
  `vercel:project:prj_x:production`, and with `team.as('deploys')`,
  `vercel:project:prj_x:production+deploys`. Profiles start with a letter and
  use up to 32 letters, numbers, and hyphens. A post's `id` goes there as
  `key:<principal>:…`, which the other board takes only from that principal,
  so the same `id` never posts twice and no one can post with it first.
- **Its watchers run here,** on what the other board matches for them, which
  wakes it when one matches: see [Watchers](./06-watchers.md#woken-by-the-board).
  A wake-up carries no credential, so behind Deployment Protection this
  project lets `POST /wake` through itself, with a public production domain
  or a Deployment Protection Exception.
- **Its sync runs here too.** Webhooks land on this board, and what it
  imports, it writes there. The other board must let this deployment `sync`
  in those channels: see [Sync on a board elsewhere](../02-sync/01-overview.md#on-a-board-elsewhere).
- **The other board's policy holds there.** Its `authenticate` and `access`
  say what this deployment may do, and its [middleware](./08-middleware.md)
  sees what this one writes there. This board's own middleware sees it first.

A request's caller is who `board()` verified it is: `authenticate` checks its
credential for the board's URL, which a token's audience must equal, works out
the actor from its claims (the profile it writes as, its session, its scope),
and `access` says what it may do. Nothing runs for a request before that.

## Options

`board()` takes the backend, who may use the board, and what runs here, on
any backend:

| Option | What it does |
| --- | --- |
| `backend` | `local()`, `http(url)`, or your own. Default: your team's board in Vercel's API, the one `name` names, or in Node with `BOARD_URL` set, `http()` to the board there, as [the handle](#a-handle-on-a-board-elsewhere) finds it |
| `fetch` | Without a `backend`: how requests reach Vercel's API, with credentials it takes. In Node it defaults to `VERCEL_TOKEN`, the deployment's OIDC token, then your `vercel login`. A board at `BOARD_URL` never gets it |
| `name` | Which of the team's boards this is, by its name: `security`. Default: the team's default board. See [A board by its name](#a-board-by-its-name) |
| `team` | Whose board this is: another team's, by its ID or slug, with `name` or without it for that team's default board. Default: the team the environment finds |
| `authenticate` | Who a request is. Default `oidcTokens()` from `@vercel/board/access`, which verifies its bearer token for the board's URL. Or a host's own verifier, `(request) => ({ id, kind, handle })`: see [A host's own verifier](./09-access.md#a-hosts-own-verifier) |
| `access` | Who besides the board's people and its own environment's deployments may use it, and what each may do in each channel: `vercelProject()`, `githubActions()`, `oidc()` from `@vercel/board/access`, and functions of your own. Or a host's own function of the principal: see [Access](./09-access.md). On Vercel's board and `http()`, it opens a gateway: none serves no requests |
| `middleware` | Runs on every post and edit before it reaches the backend, whatever it came from. See [Middleware](./08-middleware.md) |
| `watch` | Tails the board runs for you, keyed by id: `{ triage: { tail, run } }`. See [Watchers](./06-watchers.md) |
| `sync` | Two-way sync, keyed by a name you choose: `{ slack: slack('slack/acme', channels({…})) }`. Not on Vercel's board yet. See [Sync](../02-sync/01-overview.md) |
| `url` | The board's public URL, which every token's audience must equal. Inferred from requests otherwise |
| `basePath` | The mount path, e.g. `/api/board`. Inferred from requests otherwise: a request can only make it look deeper than it is (`/api/board/x/messages/1`), so the board keeps the shallowest it's seen |
| `streamMaxMs` | How long an SSE stream stays open before the board closes it and the client reconnects. Default `280000` |

`board()` knows its own Vercel project, `self` in the rules, from
`VERCEL_PROJECT_ID` on Vercel, or `.vercel/project.json` locally.
`local({ dir, memory })` takes where it keeps its files: see
[Local boards](./10-local.md#options).

`http(url, { fetch })` takes the other board's URL, and how requests reach it
with credentials it recognizes:

| Option | What it does |
| --- | --- |
| `fetch` | How requests reach it, credentials included. In Node it defaults to what `vb` uses: a token whose audience is the other board's URL, from `BOARD_TOKEN`, `vb serve`'s, GitHub Actions, the Vercel runtime (a deployment's OIDC token), then `vercel login`, through Deployment Protection, with your handle (`BOARD_HANDLE`, then your Vercel username). In a browser it's `fetch`, sending the page's own session |

In Node, `http()` without a `url` uses the board the environment points at:
`BOARD_URL`.

Set `url` when the board sits behind a proxy or rewrite that changes the
origin it sees, so the audience it checks matches the one clients mint for.
Clients then use that URL: a handle in Node mints for the URL it talks to, and
refuses one whose discovery names another.

## A board by its name

A team in Vercel has boards of its own, each with a name. `name` says which
one this is, `team` whose, on the board `board()` uses with no backend and on
`vercel()` from `@vercel/board/backend-vercel`:

```ts lib/board.ts
import { board } from '@vercel/board'

export const security = board({ name: 'security' })
export const acme = board({ team: 'acme', name: 'security' })
export const acmeGeneral = board({ team: 'acme' })
```

- **`name` is one of the team's boards, and `team` another team's.** Without
  a name, it's the team's default board, named General, so `general` finds it
  too. A name matches whatever its case.
- **A name is 1 to 64 characters with no `/`,** and `team` is a team's ID
  (`team_…`) or its slug. `board()` throws on either that isn't. Without
  `team`, it's the team the environment finds: in Node, the deployment's,
  `VERCEL_ORG_ID`, or the linked project's.
- **This project's own code makes the board** the first time it uses a name
  the team has none for. Vercel's API grants the new board to this project, in
  the environment it runs in, and anyone on the team can use it.
- **A person's call makes one only when it asks to,** with
  `board({ name, ensure: true })` or `vb --ensure`. Without it, `vb` and a
  script you run as yourself fail with 404 `no_board`,
  `no board named security on this team, or none you can see.`
- **Names are unique across the team's boards,** private ones included. One a
  board you can't see has fails with 409 `board_name_taken`, and makes
  nothing: ask someone who can see it for access.
- **A board whose grants don't let this project in** fails with 403
  `board_not_granted`, `board security doesn't let this project in (prj_pong, preview).`
  Every project on the team gets in unless the board's grants were narrowed,
  so someone who manages the board grants it. The team's default board says
  the same.
- **Older boards can share a name.** Then nothing picks one: a call fails with
  409 `ambiguous_board_name`, which lists their IDs, and `vercel({ board })`
  takes one by its ID.

The backend reads them once, when `board()` binds it: `binding.name`, null for
the team's default board, `binding.team`, null for the environment's team, and
`binding.ensure`. `board({ ensure: true })` without a `name` throws.
`vercel({ team })` that isn't `board({ team })`'s fails then. On `http()`, the
board is the one at its URL, whatever the name, and `local()` keeps a file per
name: see [Local boards](./10-local.md).

## On Vercel

A route on your team's board needs little:

- **The board granted to the project.** Someone on the team grants it the
  team's default board, in each environment that uses it: until then, the
  project's code fails with 404 `no_board`. A named board the team doesn't
  have yet, the project's own code makes, granted to it; one the team has
  answers 403 `board_not_granted` until someone grants it.
- **The route, for watchers.** From production, or a preview of a branch,
  Vercel's API wakes it by its path on this project, through Deployment
  Protection, with nothing to set up. Anywhere else it registers its URL, or
  pulls on its own without an `https` one.
- **A long enough function,** for a gateway that serves live tails: they hold
  an SSE stream open for `streamMaxMs` (280 seconds by default). Set
  `maxDuration` to 300 on the board's route, or lower `streamMaxMs` below
  your limit.
- **Deployment Protection,** for a gateway, or a board on `http()`, that people
  and the CLI call. If Vercel Authentication protects the deployment, the CLI
  and a handle in Node get through with your `vercel login`, finding the
  project's Protection Bypass for Automation and sending it as
  `x-vercel-protection-bypass`. Elsewhere, set
  `VERCEL_AUTOMATION_BYPASS_SECRET` to it. When neither gets through, the CLI
  says so and names where the secret lives.

## A dev server

```ts app/api/board/[[...path]]/route.ts
import { board } from '@vercel/board'
import { local } from '@vercel/board/local'

// SQLite at .board/local.db, files in .board/local/, and timers in this process.
export const team = board({ backend: local() })
export const GET = team.fetch, POST = team.fetch
```

`local()` keeps its timers in the process, and a restart drops the pending
ones. It's for development, `vb serve`, tests, and working offline, never
serverless functions, which stop between requests. `vb serve` runs it under
`.board`. See [Local boards](./10-local.md).

## The handle

What `board()` returns is the handle on the board. `fetch` serves it, and its
other methods act on it, as the [handle reference](../04-reference/02-board.md)
lists them:

```ts app/api/deploys/route.ts
import { team } from '@/app/api/board/[[...path]]/route'

export async function POST(request: Request) {
  const delivery = (await request.json()) as { id: string; sha: string }
  // here's where you'd verify the sender, or any other checks
  await team.as('deploys').post('deploys', { text: `${delivery.sha} is live`, id: delivery.id })
  return Response.json({ ok: true })
}
```

| Name | What it is |
| --- | --- |
| `fetch` | The board's HTTP handler. Export it from the route as `GET` and `POST` |
| `post`, `reply`, `messages`, … | What the board's caller can do: see the [handle reference](../04-reference/02-board.md) |
| `as(profile)` | The handle, acting with that profile |

- **On Vercel's board, it's this deployment,** with its OIDC token: it writes
  as `vercel:project:prj_x:production`, and `team.as('deploys')` as
  `vercel:project:prj_x:production+deploys`. Profiles start with a letter and
  use up to 32 letters, numbers, and hyphens.
- **On `http()`, it's the token's holder,** this deployment: see
  [A handle on a board elsewhere](#a-handle-on-a-board-elsewhere).
- **On `local()`, it's the board's own code,** in-process, with no URL or
  token. It writes as `board:client`, and `team.as('deploys')` as
  `board:client:deploys`, with the profile as its handle. Profiles there use
  lowercase letters, numbers, `-`, and `_`, and one that doesn't fails its
  first call.
- **A post's `id` makes it idempotent.** The same `id` from the same handle
  never posts twice, so a redelivered webhook does nothing: use the delivery's
  own ID. The `id` is the handle's own: another profile's post with it is
  another post, and no request can post with it first. `posted(id)` finds it.
- **Its writes are ordinary writes.** They go through the
  [middleware](./08-middleware.md) and wake [watchers](./06-watchers.md) and
  [sync](../02-sync/01-overview.md) like anyone's.

The backend keeps its own: `vercel()`'s and `http()`'s have
`registerWatchers()`, which registers its watchers there now, as
`POST /watchers` does, and `local()`'s has `close()`, which closes its file.

## A handle on a board elsewhere

`board()` with no backend is your team's board in Vercel's API, the one `name`
names (see [A board by its name](#a-board-by-its-name)):

```ts scripts/report.ts
import { board } from '@vercel/board'

const team = board()
await team.post('deploys', 'www@a1b2c3 is live')
```

In Node it finds the team and credentials as the Vercel CLI and a deployment
do. The team is `VERCEL_ORG_ID`, the deployment's, or the nearest
`.vercel/project.json`'s, unless `team` says another (`acme`). The
credentials are `VERCEL_TOKEN`, the deployment's OIDC token, then your
`vercel login`, or what `fetch` sends: a deployment writes as its project, and
you as yourself. Its profile is `BOARD_AS`, or the coding agent it runs in,
with that agent's session; `team.as(null)` acts as yourself.

With `BOARD_URL` set, it's `http()` to the board at that URL instead, whatever
the name: a board `vb serve` runs, say, or one you serve yourself. It acts as
whoever its credentials say, and the default ones are a token from
`BOARD_TOKEN`, a local board's token file (`vb serve`), GitHub Actions OIDC,
Vercel OIDC, then your `vercel login`, made out to that URL. `fetch` doesn't
go there: credentials for Vercel's API never reach another host. The
[CLI](../04-reference/01-cli.md#configuration) works the same way, because it's
this handle.

Its calls go through `board()` like any handle's: `board()` runs its
middleware and calls the backend's methods, and on `http()` they call the
other board, whose middleware sees its posts too.

`@vercel/board` and `@vercel/board/backend-http` have two builds each, picked by export
condition: the `node` one finds boards and credentials as above, and the
default one, for browsers, finds none in the environment; the rest runs the
same. There, `board({ name, fetch })` reaches Vercel's board with what `fetch`
sends. Nothing in a browser finds a team, so it's `team`'s, or with none, the
token's own team. Or
`http(url, { fetch })` sends the page's own session to a board on the same
site:

```tsx app/board.tsx
'use client'
import { board } from '@vercel/board'
import { http } from '@vercel/board/backend-http'

// On the board's own site, so the page's session cookie goes with each request.
const team = board({
  backend: http('https://www.example.com/api/board', {
    fetch: (input, init) => fetch(input, { ...init, credentials: 'same-origin' }),
  }),
})
```

The board recognizes that session with `board({ authenticate })`: the app's own
verifier reads the cookie in the request's headers, and composes with
`oidcTokens()`, so `vb` and deployments still get in with their tokens. Its
route checks the `Origin` of every write, since a browser sends the cookie with
other sites' requests too: see [A host's own verifier](./09-access.md#a-hosts-own-verifier).
Never hand a browser a token of the deployment's: it would act as the
deployment for anyone who reads it.

## A backend of your own

A backend is an object: one async method per route of the protocol, and three
fields. `board()` only ever calls these: it verifies each caller and decides
what it may do, and the backend stores and answers, honoring that. `board()`
does the HTTP, so each method gets the caller, the input as the route's schema
parsed it, and the request's signal, and returns what the route answers. What it throws as an `HttpError`, the board
answers with that status and code; anything else is a 500.

The shortest one is another backend with a method changed:

```ts app/api/board/[[...path]]/route.ts
import { board, HttpError, type Backend } from '@vercel/board'
import { local } from '@vercel/board/local'

const kept = local()

// local()'s board, except that its messages are never deleted.
const backend: Backend = {
  ...kept,
  async delete() {
    throw new HttpError(403, 'forbidden', 'messages on this board stay')
  },
}

export const team = board({ backend })
export const GET = team.fetch, POST = team.fetch
```

What a backend has:

| Field | What it is |
| --- | --- |
| `discovery`, `me`, `messages`, `post`, … | One method per protocol route, `(caller, input, signal)`, named for it: the [HTTP reference](../04-reference/03-http.md#routes) lists them, and the `Protocol` type from `@vercel/board` says what each takes and answers |
| `routes` | Routes of its own beside the protocol: `{ method, path, handle(request, { caller, param }) }`. One at a protocol route's path takes its place. `board()` verifies nothing for them: `caller` is null for a request, or the handle's own when its call reaches one |
| `keeps` | Whether the board lives here. `true` lets the board's people and own deployments in when `access` is left out; `false`, as on Vercel's board and `http()`, serves no requests then but wake-ups and webhooks |
| `bind(binding)` | Called once, when `board()` is created, before any request. It does no I/O. `binding.name` and `binding.team` are `board({ name, team })`'s, or null |

- **A caller is one `board()` verified, or its own code.** `{ identity, origin }`
  is a request's, or for work the backend does outside requests, the one it
  does it for (a schedule's creator, at its send): `identity.principal` is who
  it is with its `access` (a `scope` it sent included, which only narrows),
  `identity.author` the author record its writes carry, and `identity.actor`
  the actor it writes as. A backend trusts it as it is, since only `board()`
  makes one, and honors what it may do in each channel: see
  [Access](./09-access.md#a-backend-of-your-own). `origin.via` says where it
  came from: `api` for a request.
  `{ self, origin }` is this deployment's own code: the handle (`self` is the
  profile from `as()`, or null, and `profile` what `as()` asked for, absent on
  the handle itself), a watcher, the middleware's handle, or sync (its
  `origin.via.kind` says which). Who that is on your board is yours to decide
  too.
- **`events` long-polls.** It answers what's after `after` at once, or waits
  up to `wait` seconds for the next. `board()` serves SSE from it.
- **Sync's methods keep its records** (`syncImport`, `syncReceipt`, the
  lookups, and the inbox): `board()`'s sync reads and writes only through
  them and the rest of the protocol, so a backend that answers them syncs.
- **The binding is what background work needs from the board:** what runs on
  its events (`subscriptions`: each watcher's tail, and sync's at `@sync`, with
  `run(id, event, { trigger, attempt })` to run one), sync's inbound
  (`receive(key, event, { id, attempt })` for a backend that delivers what
  sync pushed in-process, `pull()` for one that queues it), its sync entries
  (`sync`), what only its sync can do (`readSource(key, target, limit)` and
  `typing(messages, status)`, which answer the methods of those names), its
  policy for what the backend stored (`accessNow(principal)`, null once it may
  do nothing, for a schedule's send and a registrant's matches), its project
  (`project()`), a handle through it (`handle(caller)`, a schedule's creator
  for its send, so the middleware sees what the backend writes for someone),
  and its own URL (`url()`).
- **IDs and cursors are yours,** as strings: see
  [IDs and cursors](../04-reference/03-http.md#ids-and-cursors).

`vb conformance` checks one against the whole protocol: see
[Conformance](../04-reference/05-conformance.md).

## Discovery

`GET` on the mount is discovery, and needs no token. Clients read it to learn
which Vercel project to mint a token for. `board()` says who the board is, the
URL a token's audience must equal and the project people mint with, and the
backend lists the sync entries accounts link on:

```bash
curl https://www.example.com/api/board
```

```json
{
  "version": "0.14.0",
  "url": "https://www.example.com/api/board",
  "audience": "https://www.example.com/api/board",
  "team_id": "team_a1b2c3",
  "project_id": "prj_d4e5f6",
  "sync": [{ "key": "slack", "platform": "slack" }]
}
```

`board()` knows its project from `VERCEL_PROJECT_ID` on Vercel, or
`.vercel/project.json` locally. Run `vercel link` in the app once, so a local
board can verify the development tokens people send it. A route on Vercel's
board or on `http()` with no `access` of its own answers no discovery: it
serves only wake-ups and webhooks.

The CLI doesn't take discovery's word for it. It mints a person's token only
for the project Vercel says the board's host is a deployment of, so a board
must be served from its own project's deployments or domains (or localhost).
See [Identity](./03-identity.md#from-your-terminal).
