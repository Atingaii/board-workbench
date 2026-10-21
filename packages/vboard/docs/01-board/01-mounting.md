---
title: Mounting
description: "One `board()` call in one route, on a backend: `a2()` keeps the board in this deployment, and `http()` uses another one."
---

## One route

```package-install
npm i vboard
```

```ts app/api/board/[[...path]]/route.ts
import { a2, board } from 'vboard'

export const { GET, POST } = board({ backend: a2() })
```

That's a board. It answers at `/api/board`, and the CLI points at it with
`VBOARD_URL` or `vb link`. Call `board()` once, at module scope. A host that
serves many teams' boards creates one per team instead, and caches them: see
[A host's own verifier](./09-access.md#a-hosts-own-verifier).

A board is one log in one route of one Vercel project. The mount path is yours:
the board infers it from requests. To get a second board (one the project's
own people can't all read, say), mount a second route.

## Backends

`backend` says where the board lives:

| Backend | What it does |
| --- | --- |
| `a2({ store, … })` | Keeps the board in this deployment, on A2's log: the store, the scheduler, sync, access, and everything else below |
| `http(url)` | Uses the board at `url`, which keeps the log. This project reads and writes it as itself |

```ts app/api/board/[[...path]]/route.ts
import { board, http } from 'vboard'

export const { GET, POST, client } = board({ backend: http('https://board.example.com/api/board') })
```

A board on `http()` keeps nothing:

- **Its discovery names the other board,** and every other route answers 404
  with code `remote`. The CLI pointed at it says where to go:
  `error: https://www.example.com/api/board keeps no log: use https://board.example.com/api/board`.
- **`client(name, { key })` writes there as this deployment,** with `name` as
  its profile: `vercel:project:prj_x:production+deploys`. Names start with a
  letter and use up to 32 letters, numbers, and hyphens. With a `key`, its
  posts get IDs derived from the key, `key:<principal>:…`, which the other
  board takes only from that principal, so the same key never posts twice and
  no one can post with one first.
- **Its watchers run here,** on what the other board matches for them: see
  [Watchers](./06-watchers.md#on-a-board-on-http).
- **`store`, `sync`, `access`, and the rest belong to the other board,** so
  `http()` takes none of them.

Any board that speaks the [protocol](../04-reference/03-http.md) works with
`http()`, the CLI, and the SDK, on A2 or not. `vb conformance` checks one; see
[Conformance](../04-reference/05-conformance.md).

## Options

`board()` takes the backend and what every backend shares:

| Option | What it does |
| --- | --- |
| `backend` | `a2({ … })` or `http(url)`. Required |
| `watch` | Tails the board runs for you, keyed by id: `{ triage: { tail, run } }`. See [Watchers](./06-watchers.md) |
| `url` | The board's public URL, which every token's audience must equal. Inferred from requests otherwise |
| `basePath` | The mount path, e.g. `/api/board`. Inferred from requests otherwise |

`a2()` takes the rest:

| Option | What it does |
| --- | --- |
| `store` | Where the board keeps its log and the tables it reads: `postgres()`, `sqlite()`, or `memory()` from `vboard/store-*`. See [Database](./02-database.md) |
| `blob` | Where [attachments](./04-messages.md#attachments) live: `vercelBlob()` from `vboard/adapter-vercel-blob`, with an optional `prefix` to share one store between boards |
| `scheduler` | For sync, watchers, and scheduled messages: `vercelQueues()` from `vboard/scheduler-vercel`, or `qstash()` from `vboard/scheduler-qstash` |
| `sync` | Two-way sync, keyed by a name you choose: `{ slack: slack({…}) }`. See [Sync](../02-sync/01-overview.md) |
| `middleware` | Runs on every post and edit before it lands. See [Middleware](./08-middleware.md) |
| `access` | Who besides the board's people and its own environment's deployments may call it, and what each may do in each channel: `vercelProject()`, `githubActions()`, `oidc()`. Or a function that verifies callers itself: see [A host's own verifier](./09-access.md#a-hosts-own-verifier) |
| `project` | `{ id, teamId? }`: the board's Vercel project. Defaults to `VERCEL_PROJECT_ID`, then `.vercel/project.json`. The team scopes `vercelProject()` rules named without one |
| `streamMaxMs` | How long an SSE stream stays open before the board closes it and the client reconnects. Default `280000` |
| `auth` | Test issuers, for tests only. Production verifies against Vercel's and GitHub's |

Set `url` when the board sits behind a proxy or rewrite that changes the
origin it sees, so the audience it checks matches the one clients mint for.
Clients then use that URL: the Node client mints for the URL it talks to, and
refuses one whose discovery names another.

## A production board

```ts app/api/board/[[...path]]/route.ts
import { a2, board } from 'vboard'
import { vercelBlob } from 'vboard/adapter-vercel-blob'
import { vercelQueues } from 'vboard/scheduler-vercel'
import { postgres } from 'vboard/store-postgres'

// SSE streams close just before this, and clients reconnect where they left off.
export const maxDuration = 300

export const { GET, POST, scheduler, client } = board({
  backend: a2({
    store: postgres({ connectionString: process.env.DATABASE_URL! }),
    blob: vercelBlob(),
    scheduler: vercelQueues({ topic: 'vboard' }),
  }),
})
```

`postgres()` needs `pg` installed, and the board's tables applied to the
database before the first deploy: see [Database](./02-database.md#postgres).
`vercelQueues()` needs `@vercel/queue`. `vercelBlob()` needs `@vercel/blob` installed and a private Blob store
connected to the project. It finds the store through `BLOB_READ_WRITE_TOKEN`,
or the project's OIDC token and `BLOB_STORE_ID`.

## The scheduler route

Mount the `scheduler` that `board()` returns as `POST` in a route of its own:

```ts app/api/a2/scheduler/route.ts
export { scheduler as POST } from '@/app/api/board/[[...path]]/route'
```

```json vercel.json
{
  "functions": {
    "app/api/a2/scheduler/route.ts": {
      "experimentalTriggers": [
        { "type": "queue/v2beta", "topic": "vboard", "retryAfterSeconds": 30 }
      ]
    }
  }
}
```

Keep it out of the board's catch-all route. A Vercel Queues trigger makes its
function private, and the board's routes must stay public: people, CI, and
platform webhooks all call them.

The scheduler serves every A2 server behind the board: the log, the sync inbox,
watchers, and schedules. To share one scheduler with A2 servers of your own,
pass the same scheduler to `a2()` and to them, and hand the board's
`servers` to its handler yourself:

```ts lib/queue.ts
import { vercelQueues } from 'vboard/scheduler-vercel'

// One scheduler for the board (`board({ backend: a2({ store, scheduler: queue }) })`) and your own A2 servers.
export const queue = vercelQueues({ topic: 'vboard' })
```

```ts
// app/api/a2/scheduler/route.ts, with the queue shared:
import { queue } from '@/lib/queue'
import { servers } from '@/app/api/board/[[...path]]/route'
// import { ordersServer } from '@/server/orders'   // yours, created with the same queue

export const POST = queue.handler(...servers /*, ordersServer */)
```

## What `board()` returns

| Name | What it is |
| --- | --- |
| `GET`, `POST` | The board's fetch handlers. Export both from the route |
| `fetch` | The same handler, for runtimes that take one function |
| `scheduler` | The scheduler's callback, for its own route. A board without a scheduler answers 404 there, as does one on `http()` |
| `servers` | On `a2()`: the A2 servers behind the board, to pass to a shared scheduler |
| `client(name, { key })` | A client for your own server code: in-process on `a2()`, over HTTP on `http()` |
| `remote` | On `http()`: the URL of the board it uses |

## The in-process client

Your own routes can write to the board without a URL or a token:

```ts app/api/deploys/route.ts
import { client } from '@/app/api/board/[[...path]]/route'

export async function POST(request: Request) {
  const delivery = (await request.json()) as { id: string; sha: string }
  // here's where you'd verify the sender, or any other checks
  await client('deploys', { key: delivery.id }).post('deploys', `${delivery.sha} is live`)
  return Response.json({ ok: true })
}
```

- **It writes as `vboard:client:<name>`,** with the name as its handle. Names
  use lowercase letters, numbers, `-`, and `_`.
- **A `key` makes its posts idempotent.** The same key and the same order of
  posts never post twice, so a redelivered webhook does nothing. Use the
  delivery's own ID.
- **Its writes are ordinary writes.** They wake [watchers](./06-watchers.md)
  and [sync](../02-sync/01-overview.md) like anyone's.
- It's the same client `createClient` returns; see the
  [client reference](../04-reference/02-client.md).

## Discovery

`GET` on the mount is unauthenticated. Clients read it to learn which Vercel
project to mint a token for:

```bash
curl https://www.example.com/api/board
```

```json
{
  "version": "0.5.2",
  "url": "https://www.example.com/api/board",
  "audience": "https://www.example.com/api/board",
  "team_id": "team_a1b2c3",
  "project_id": "prj_d4e5f6",
  "sync": [{ "key": "slack", "platform": "slack" }]
}
```

The board knows its project from the `project` option, `VERCEL_PROJECT_ID` on
Vercel, or `.vercel/project.json` locally. Run `vercel link` in the app once,
so a local board can verify the development tokens people send it.

## Defaults by environment

What `a2()` uses when you leave an option out:

| Option | Development | Tests | Production |
| --- | --- | --- | --- |
| `store` | SQLite at `.a2/dev.db` | memory | an error at startup |
| `blob` | files in `.a2/attachments` | memory | none: uploads answer `no_blob_store`, and the rest of the board works |
| `scheduler` | none | none | none |

Development state survives restarts. Sync and watchers need a scheduler in
production. [Scheduled messages](./07-schedules.md) need one everywhere: without
it, scheduling answers 501.

## Production checklist

- **A store.** `postgres()`, with its tables applied: see
  [Database](./02-database.md#postgres). A board without one doesn't start.
- **A blob store,** if anyone attaches files: `blob: vercelBlob()`.
- **A scheduler,** if you use sync, watchers, or scheduled messages, mounted in
  [its own route](#the-scheduler-route) with its queue trigger.
- **A long enough function.** Live tails hold an SSE stream open for
  `streamMaxMs` (280 seconds by default). Set `maxDuration` to 300 on the
  board's route, or lower `streamMaxMs` below your limit.
- **Deployment Protection.** If Vercel Authentication protects the
  deployment, the CLI says so:
  `error: <url> is behind Vercel Deployment Protection; set VERCEL_AUTOMATION_BYPASS_SECRET (…)`.
  Set `VERCEL_AUTOMATION_BYPASS_SECRET` to the project's Protection Bypass for
  Automation secret; the CLI and Node SDK send it as `x-vercel-protection-bypass`.
  Webhooks need a way through too; Vercel Connect forwards them through
  protection.
- **Access.** Access to the board is access to its Vercel project: everyone
  who should post needs it. See [Identity](./03-identity.md).
