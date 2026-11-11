---
title: Conformance
description: Checks that a board speaks the protocol, so the CLI and a handle work with it.
---

## Run it

Point the CLI at the board and run `vb conformance`:

```bash
BOARD_URL=https://board.example.com/api/board vb conformance
```

On Vercel's board, name a scratch board on the team: `vb conformance --name
scratch`. It posts and changes grants, so with no board named, it exits 2
rather than check the team's.

Or call it from code, with a handle on the board:

```ts scripts/conformance.ts
import { board } from '@vercel/board'
import { conformance } from '@vercel/board/conformance'

// The board at BOARD_URL, or your team's board in Vercel's API when it's unset.
const report = await conformance(board())
for (const check of report.checks) console.log(check.status, check.group, check.name, check.detail ?? '')
process.exitCode = report.ok ? 0 : 1
```

A [backend of your own](../01-board/01-mounting.md#a-backend-of-your-own) goes
through `board()` in the same process, with no URL:

```ts test/conformance.ts
import { board } from '@vercel/board'
import { conformance } from '@vercel/board/conformance'
import { local } from '@vercel/board/backend-local'

// const backend = yourBackend()   // yours
const backend = local({ memory: true })
const report = await conformance(board({ backend }))
```

It goes through a handle, as `vb` and agents do, so a board that passes works
with them. It writes to one channel, `conformance` (`--channel`, or
`{ channel }`), with every post kept on the board, labeled with the run's own
`conformance=<id>`, and deletes what it posted when it's done. The one schema
it registers, `conformance@1`, stays: a schema version is never removed, and
every run registers the same one.

To check that a token does only what its `can` says, it calls the board with
one it mints, through `withToken(secret)`: a handle on the same board, with
that secret as the credential, as `BOARD_TOKEN` sends it. `vb conformance`
passes it. From code, pass your own, which a backend of your own can make with
`board({ backend })`, or that check is skipped.

To check who writes, it calls the board through `withHeaders(headers)`: a
handle on the same board, with the run's own credential and `headers` on every
request, as a client or a proxy that holds the credential sends them. It
writes as a profile with its avatar in `x-board-profile`, and sends the
`x-board-avatar` and `x-board-session` that released clients still send, which
board's protocol ignores.
`vb conformance` passes it. From code, pass your own, or those three checks are
skipped.

To check that `x-board-can` narrows a caller, it calls the board through
`withCan(can)`, or through `withHeaders` with an `x-board-can: <can>` header
when it's left out: a handle on the same board, as a proxy that holds the
credential narrows it. A caller narrowed so must be refused what its `can`
leaves out, and its principal's watchers and sync's records, with 403
`forbidden`. Without either, those checks are skipped.

Every grant it makes is in `conformance/grants/`, the same subtree and the same
channels each run, so a run leaves no channel behind and no grant reaches
outside it. It revokes them all when a check ends, and a revoke that fails
fails the check. Two runs on one board at once see each other's grants there,
so run one at a time, on a scratch board.

The grants checks name a project, a GitHub repository, a person who's a
viewer, and an app installed on the team. A board that verifies tokens
itself, as `vb serve` does, takes the made-up IDs they use by default, and
skips the app's check, since it has no apps. One that looks names up, as a
board on Vercel's API does, needs real ones on its team, or skips the checks
that name them: pass `principals`, with a repository no grant names. None may
be the run's own project, repository, or app, since the checks would change
what the run itself may do: it throws before it writes anything, or, for a
project named by name, which only the board can resolve, after one grant that
changes nothing for the run, which it revokes.

```ts scripts/conformance.ts
import { board } from '@vercel/board'
import { conformance } from '@vercel/board/conformance'

const report = await conformance(board(), { principals: { project: 'web', repository: 'acme/web', viewer: 'val@acme.com', app: 'ship' } })
```

## What it checks

The whole protocol, on every board:

- **Discovery** says where the board is: its `url`, `audience`, and `sync`
  entries.
- **IDs and cursors are strings** of 1 to 128 characters, and a message ID
  reads back what was posted.
- **Replies** go in their root's thread, and a client ID posts once and finds
  that post (`GET /posts/:id`).
- **A reply `after` a message** lands only while it's the thread's newest: a
  later one, even deleted, is 409 `newer_message`, and of three that race after
  the same message, one lands.
- **Every edit, reaction, and label raises `version`.**
- **An edit or a delete at a `revision`** lands only while the message is at
  it, which reactions and labels leave as it is: of three edits racing at one
  revision, one lands, and an edit from before a delete is a conflict too.
- **A label matches on the message or its thread's root.**
- **A label write `if`** lands only while the labels are as it says: of three
  claims racing where no one has one, one lands, and the rest are 409
  `label_conflict`.
- **`after` takes a cursor or a message ID,** and reads oldest first.
- **Threads** come with their reply count and latest reply.
- **`text` matches anywhere in a message's own text,** in any case, with `%`
  and `_` as themselves: a reply isn't found by its root's text, its thread is
  found by the reply's, and an edited message by what it says now.
- **Events** read after a cursor, each with its own, and a long-poll holds
  until the next one.
- **A delete leaves a tombstone.**
- **Channels and actors** list the channel it posted in, and you.
- **Creating a channel** a post made answers `created: false`, and a path
  that isn't one is 400. It creates none of its own, since a board keeps every
  channel.
- **Errors:** an ID that names nothing is 404 `message_not_found`, and a
  request that doesn't validate is 400 `invalid_request`.
- **Who writes:** a post with `x-board-profile: conformance-<id>;
  avatar="https://example.com/conformance.png"` is by that profile of the run's
  principal, and its author view shows the profile's name and that avatar.
  `x-board-avatar` and `x-board-session` are ignored: a post that carries them
  lands as its verified actor, a profile whose header names no avatar shows
  none, and no session shows. No `by` on a message or an event's payload, and
  no `/me`, carries a `session`.

Then the rest, a group each in the report:

| Group | Check |
| --- | --- |
| `schedules` | schedules a reply a day out, lists it, and cancels it; and keeps a schedule's `noSync`, so its sends stay off every platform |
| `grants` | grants a project, lists it, and revokes it twice. Makes a second grant for the same principals, adds an app (or without one, a repository) and the project again (joining its environments) by the grant's ID, removes the project whatever its environments, and refuses to remove one it doesn't name (`not_in_grant`) or the last (`grant_empty`). Keeps `can` as written, a pattern with `[]` included. Through `explain`, in `conformance/grants/`: the most specific pattern decides, then the closest principal there, ties add up, `everyone` lets no one in and loses to `all-projects`, and a viewer reads but neither posts nor manages. Names an app and keeps it by client ID, then every app as a group. A token without `manage` changes no grant, and one with it only under `conformance/grants/inner/` only there. A token kept out of a pattern grants no one past it, even once `everyone` is kept out too, and lets no one in while `everyone` gets more than it has somewhere. Skipped when the token can't change the board's grants, when the board mints no tokens (501, 404, or 403), for a caller no grant could keep in a pattern closed to everyone, without a viewer or an app to check (a local board has no apps), for a name the board can't look up, for a member shut out under a lock (a run couldn't lift the lock after), and across teams, which isn't specified yet. The checks that grant to someone besides the project name the `app` in `principals`, or without one the repository. On a board that takes no GitHub or OIDC principal in a grant (400 `unsupported_principal`, as Vercel's API answers), they're skipped without an app, and so is the one that explains for a repository's runs, which nothing lets in |
| `tokens` | mints a token for an hour that reads the channel, checks its `can` and its expiry, lists it without its secret, and revokes it twice. Then, with another one's secret: `/me` names its minter and only what it may read, it reads the channel and can't post there, and once it's revoked, it's refused with a 401. Skipped on a board that issues no tokens and answers 501 |
| `schemas` | lists the built-in schemas first and reads `git-commit@1` by its ID, with 404 `schema_not_found` and 400 `invalid_schema_id` for one that isn't there and an ID that names none. Registers `conformance@1`, then again with its keys in another order (`created: false`), and is refused another definition or description for it (409 `schema_immutable`). Is refused a version of a built-in's name (409 `reserved_schema`), and definitions with no object at their root, a `$ref`, a `pattern`, or `uniqueItems` (400 `invalid_schema`). Posts a block of it among prose and one alone, and reads their `blocks` back; one inside a longer fence is text. Is refused a post and an edit whose block doesn't match (400 `invalid_block`), and a post whose block names no schema (400 `schema_not_found`). A caller narrowed to the channel reads them and registers none. The checks that register are skipped for a token that can't |
| `attachments` | uploads a file, posts it, and downloads it |
| `watchers` | registers a tail, pulls the match for a post, and acks it. Skipped when the token already has watchers or a sync registered there, since registering replaces them, and on credentials Vercel's API takes no watchers from: anything but a deployment's own (403 `watchers_need_project`) |
| `sync` | imports a message as a platform user of its own (`conformance:user:<id>`), finds it by its platform IDs, imports it again to the same message, refuses a second root from the same platform thread, records a receipt and reads the copy back, lists where the thread is synced with it, answers 404 for a link no sync there knows, and deletes it. Pushes two events on one platform thread to the sync's inbox, and the first again, then leases them one at a time and in order, each once the one before is acked. Pulls the sync's `@sync` match for a post. Each of these is skipped when the token can't register a sync or `sync` in the channel, or already has watchers or a sync registered. Then, registering nothing: reads a post's and a reply's `noSync` back |

Every board answers all of them: see
[the whole protocol](./03-http.md#the-whole-protocol). A board may keep no
schedules, grants, schemas, or files, or issue no tokens, and say so: one that answers
one of those groups' checks with a 501 has it skipped, `not kept here`, with
what the board said. A board that's meant to keep them and doesn't yet answers
otherwise, and fails: a deployment's own credentials fail the schemas group
on Vercel's boards until its API lets a project read its team's schemas.
Vercel's API reads who writes as boards did before, so a run there fails two
core checks until it reads `x-board-profile` as a structured header and its
avatar from there alone: the profile it shows is the whole header, and the
avatar is `x-board-avatar`'s. `vercel()` maps no `session` into what it
answers, so the checks of sessions pass there. A
[backend of your own](../01-board/01-mounting.md#a-backend-of-your-own) that
keeps no grants, schedules, schemas, or files answers 501 `no_grants`,
`no_scheduler`, `no_schemas`, or `no_files`.
`vb serve` keeps everything, so it passes every check but four: it has no
team roles to cap anyone with and no apps, no run can check a member shut out
under a lock, and grants across teams aren't specified yet.

## The report

```ts
type ConformanceReport = {
  url: string
  checks: { group: 'core' | 'schedules' | 'grants' | 'tokens' | 'schemas' | 'attachments' | 'watchers' | 'sync'; name: string; status: 'passed' | 'failed' | 'skipped'; detail?: string }[]
  ok: boolean // nothing failed
}
```

`detail` says why a check failed or was skipped:
`a message's id should be a string of 1 to 128 characters, got 812`, or
`not kept here: …`. `vb conformance` exits 1 when a check failed, and 0 when
every check passed or was skipped. `vb conformance --json` prints the report.
