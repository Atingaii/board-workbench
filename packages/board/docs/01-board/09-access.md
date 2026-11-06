---
title: Access
description: "Who may use a board, and what each caller may do in each channel: read, post, react, label, sync, or manage. Its people and its own deployments get everything, and grants and board tokens let others in while it runs. Anything out of reach answers 404."
---

## Who gets what

This is the policy of a board `board()` keeps: one on
[`local()`](./10-local.md) or a [backend of your own](#a-backend-of-your-own).
Vercel's board says who may use it in Vercel's API: the team's people, and the
projects it grants the board to (see
[A board by its name](./01-mounting.md#a-board-by-its-name)). A route on
Vercel's board, or on the board at `BOARD_URL`, serves no callers of its own:
it answers only wake-ups and webhooks.

Every caller is an OIDC principal. `board()` verifies it with its
`authenticate` (see [Identity](./03-identity.md)), works out what it may do,
then calls its backend with the caller it verified. The policy is the board's
on every backend, and the backend only stores. Some get everything without
asking; the rest get what grants and board tokens give them:

| Caller | Default |
| --- | --- |
| A person: your `vercel login`, or `vb serve`'s local user | everything |
| The board's own deployments in the environment it runs in | everything |
| The board's own deployments in any other environment | what its [grants](#grants) give, or nothing |
| Another Vercel project, a GitHub Actions workflow, any other OIDC issuer | what its grants give, or nothing |
| A [board token](#tokens) | what its minter may do, narrowed to its `can` |
| The board's own code: watchers, sync, middleware, its [handle](./01-mounting.md#the-handle) | everything |

A token no grant lets in is refused with 403, whatever it asks, and one from
an issuer no grant names with 401.

The board's environment is the one Vercel runs it in (`VERCEL_TARGET_ENV`,
which names custom environments, or `VERCEL_ENV`). A production board trusts
its production and refuses its previews, which run any branch's code. A
preview board trusts its own previews, so a preview can call itself. Outside
Vercel, only people get in without a grant. A refused token's 403 says which
grant would let it in, as a command to run:

```json
{
  "error": {
    "code": "forbidden",
    "message": "this token can't use this board: no grant lets in acme/www",
    "hint": "Grant it: vb grants create github --claim repository=acme/www"
  }
}
```

A production board's own previews hear `it runs in production, and its
preview deployments need a grant`, with the grant for their project in
`preview`.

## Grants

A grant lets callers in by their tokens: an issuer, the claims its tokens
carry, and what they may do in each channel. The board keeps it, so people let
a CI run or another project in while the board runs, with no deploy:

```ts scripts/grants.ts
import { board } from '@vercel/board'

// The board at BOARD_URL, one that keeps grants: vb serve's, say.
const team = board()

// acme/web's runs report in ci/ and read the replies there.
const { grant } = await team.createGrant({ issuer: 'github', claims: { repository: 'acme/web' }, can: { 'ci/': ['read', 'post'] } })
// front's production deployments post feedback, and do nothing else.
await team.createGrant({ issuer: 'vercel', claims: { project_id: 'prj_front', environment: 'production' }, can: { 'feedback/': ['post'] } })
console.log(await team.grants())
await team.revokeGrant(grant.id)
```

```text
$ vb grants create github --claim repository=acme/web --can ci/=read,post
granted g1
$ vb grants create vercel --claim project_id=prj_www --claim environment=preview --can dev/=read
granted g2
$ vb grants
g1  github  repository=acme/web                     ci/=read,post
g2  vercel  environment=preview project_id=prj_www  dev/=read
$ vb grants revoke g1
revoked g1
```

The second lets a production board's own previews, `prj_www`'s, read `dev/`
and nothing else.

- **A grant is an issuer, the claims its tokens carry, and `can`.** `vercel`
  and `github` name those issuers; any other is an https URL on the internet,
  and the board fetches its keys once a grant names it, by OIDC discovery: its
  `/.well-known/openid-configuration` must name it as `issuer`, with a
  `jwks_uri` that's an https URL on the internet, and no redirect is followed. Every claim must match
  exactly, and a list is any of its values (`--claim` twice with one name).
- **It names who it lets in.** A Vercel grant names `project_id` and
  `environment`, since a preview runs any branch's code, and a GitHub grant
  `repository` or `repository_id`: those issuers sign tokens for everyone they
  serve. Any other issuer's names at least one claim. A claim is any one its
  tokens carry: GitHub's `event_name` or `ref`, GitLab's `project_path`.
- **It's for callers on the board's team.** Until cross-team access exists, a
  caller on another team gets in only with a [board token](#tokens) that
  someone on the board's team mints for it.
- **The same issuer and claims are one grant.** Setting it again changes its
  `can` (`updated g1`). Claims that differ, such as another environment, are
  another grant.
- **`can` left out is read, post, react, and label everywhere,** what Vercel's
  API gives a project it lets use a board.
- **Grants add up.** A caller gets what every grant that matches its token
  gives. People and the board's own deployments where it runs are never a
  grant's: they have everything already.
- **Grants are the board's bookkeeping:** setting, listing, and revoking them
  takes `manage` in every channel. A revoke holds from the next request, and a
  schedule a principal made stops as any creator's does when it loses access.

## Tokens

A token is a credential the board issues, for what has no OIDC token of its
own: a widget, a sandbox, a script on a laptop. It acts as whoever minted it,
narrowed to its `can`:

```text
$ vb tokens create feedback-widget --can feedback/=post
board_7pQ…
$ BOARD_TOKEN=board_7pQ… vb post feedback/web "love the new board"
2
$ BOARD_TOKEN=board_7pQ… vb post dev hi
error: You can't post to dev.
  this token can't post in dev
$ vb tokens
t1  feedback-widget  feedback/=post  expires in 30d
$ vb tokens revoke t1
revoked t1
```

```ts scripts/sandbox-token.ts
import { board } from '@vercel/board'

// The board at BOARD_URL, one that issues tokens: vb serve's, say.
const team = board()

// Every request with it writes as clever-lemur, from session thread-1956, in dev/ at most.
const { token, secret } = await team.createToken({ name: 'sandbox-1956', can: { 'dev/': ['read', 'post', 'react'] }, profile: 'clever-lemur', session: 'thread-1956', expires: '7d' })
// sandbox.env.BOARD_TOKEN = secret   // yours
await team.revokeToken(token.id)
```

- **The secret shows once,** when it's minted: `board_` and 43 more
  characters. The board keeps its SHA-256. It goes where any token does,
  `Authorization: Bearer`, and `BOARD_TOKEN` for `vb` and the handle.
- **It's its minter, narrowed.** Any caller mints one: a person, a deployment,
  a workflow. Its access is worked out on every request, under the grants as
  they are then, and narrowed to its `can`, so it never does more
  than its minter could at that moment. A person's token writes under their
  handle; a workflow's token loses what its grant gave once the grant goes.
- **`can` left out is a grant's default:** read, post, react, and label
  everywhere. A token gets `sync` or `manage` only when its `can` says so,
  `--can '*=all'` for everything its minter may do.
- **It's never its minter's integration,** even with `*=all`: like any
  [narrowed](#narrowing-a-token) caller, it can't register watchers or write
  sync's records, which take the minter's own credential.
- **A person's token outlives their access to the project,** as their
  schedules do: the board can't tell they left. Revoke their tokens when they
  go (`vb tokens` with `manage` lists everyone's).
- **It may pin a profile, with its avatar, and a session.** Every request with
  it writes as them, whatever the request says. Without them, a request labels
  itself as any does: `vb` in Claude Code writes as `claude` under you. One that
  pins a profile edits, deletes, and cancels only what was written as that
  profile, not your own posts. Another token that pins it is the same author.
- **It expires** 30 days after it's minted, or after `expires`, 90 days at
  most. A token minted with a token is its child: it keeps its parent's pins,
  is narrowed to its parent's `can`, lives no longer, and stops when its parent
  does.
- **Revoking it holds from the next request,** for it and every token minted
  with it, and cancels a schedule made with it, `revoked`. A schedule made with
  it ends by its expiry, which its `until` shows, and one that would first
  send later is refused, `token_expires_first`. Its minter lists and
  revokes their tokens; `manage` in every channel lists and revokes everyone's.
  A token lists and revokes only itself and the tokens minted with it, so a
  widget's token never reaches your others. Revoking someone else's answers as
  one that isn't there: `revoked: false`.
- **`board()` checks its own,** before `authenticate` runs, so a
  [verifier of your own](./01-mounting.md#callers-of-your-own) never sees
  them.
- **It's how another team's callers get in,** until cross-team access exists:
  someone on the board's team mints one for them, narrowed to what they need.

## A backend of your own

`board()` hands every backend a caller it verified, `{ identity, origin }`, or
its own code, `{ self, origin }`. A backend of your own trusts the first, since
only `board()` makes one, and honors what it may do in each channel:

```ts lib/backend.ts
import { HttpError, type Caller } from '@vercel/board'

/** What a caller may read: every method that shows messages asks. */
export function readable(caller: Caller, channel: string) {
  // This deployment's own code: yours to decide.
  if (!('identity' in caller)) return true
  return caller.identity.principal.access.readable(channel)
}

export function mayPost(caller: Caller, channel: string) {
  if ('identity' in caller && !caller.identity.principal.access.can('post', channel)) throw new HttpError(403, 'forbidden', `this token can't post in ${channel}`)
}
```

`identity` is the principal with its `access`, the author record its writes
carry, and the actor it writes as. What a backend stores for later, a
schedule's creator or a registrant, it asks `board()` about again through its
binding's `accessNow(principal)`, and it writes for someone outside a request
through the binding's `handle(caller)`, so the middleware sees it.
`@vercel/board/access` has the pieces `board()` uses:

| Export | What it does |
| --- | --- |
| `oidcTokens(options?)` | An `authenticate`: the OIDC tokens made out to this board. It verifies a request's bearer token for its audience, from Vercel, GitHub Actions, an issuer a grant names (`board.issuers`), or `local` (`vb serve`'s). Null with no token, a 401 for a bad one. Without `board`, the project is the environment's. `board()`'s default |
| `resolveActor(principal, claims, audience)` | The actor a caller writes as: `vercel:user:u_123+claude` for a profile, a person's handle and name from their claims |
| `compileAccess(can)`, `union(accesses)`, `FULL_ACCESS` | What a `can` allows on its own, as an `Access`: `can(permission, channel)`, `readable(channel)`, `everywhere(permission)`, `summary()` for `me`, and `narrow(scope)` to keep only what both allow. `union` adds up what several allow, as grants do: accesses from `compileAccess`, `union`, or `narrow`, and anything else counts as nothing. Each is frozen. A bad pattern or permission throws. For a backend that checks a caller against a `can` of its own |
| `DEFAULT_CAN` | The `can` a grant or a token gets when it names none: `{ '*': ['read', 'post', 'react', 'label'] }` |

## Permissions

| Permission | Allows | Implies |
| --- | --- | --- |
| `read` | messages, threads, `/events` (tail, wait, poll), schedules, the channel in `vb channels`, attachments on readable messages | |
| `post` | start a thread; create a channel, with `read`; edit and delete your own messages; upload; schedule a root | |
| `react` | add and remove reactions | `read` |
| `label` | set and unset labels, including labels on a post | `read` |
| `sync` | attach a thread to a Slack or GitHub thread, including `--sync` on a post; speak for platform users there, through [sync's routes](../04-reference/03-http.md#syncs-routes); in every channel, the board's own inbox | `read` |
| `manage` | cancel anyone's schedule there; in every channel, source reads | everything |

- **A reply needs `post` and `read`** in its thread's channel. Addressing a
  thread you can't read would confirm it exists. So `['post']` alone starts
  threads and fixes what it wrote, which is what a feedback intake or a CI
  reporter does.
- **The board's bookkeeping needs every channel:** a source read needs
  `manage` in all of them, since the app's token reads past any one, and its
  inbox needs `sync` in all of them, since raw events span them.
  `{ '*': 'all', 'security/': [] }` can do neither.
- **`sync` speaks for platform users.** A caller with it in a channel can write
  there as any Slack, GitHub, or Linear user it names, which is what a
  deployment that syncs onto this board needs. Who those users are (name,
  handle, avatar) shows in every channel, so only the board's own sync, or one
  with `sync` in every channel, changes that: anyone else's imports name their
  author and leave the record be. Give it only to the deployment that runs the
  sync: see [what `sync` grants](../04-reference/03-http.md#what-sync-grants).
- **`sync` attaches only a platform thread no other board thread has.** Taking
  one over would send its replies to a channel its readers may not be in, so
  it's a 409 with `already_synced`. A caller that reads the other thread's
  channel is told which thread it is. Imports and delivery receipts hold to it
  too: neither can say a message came from, or landed in, a platform thread or
  message another board thread or message has.

## Channels

`can` takes `'all'`, a list, or a map from pattern to permissions:

| Pattern | Covers |
| --- | --- |
| `*` | every channel, including ones that don't exist yet |
| `feedback` | the channel `feedback` |
| `feedback/` | `feedback` and everything under it, like `vb tail feedback/` |

- **The most specific pattern decides:** an exact channel, then the longest
  subtree, then `*`. `{ '*': 'all', 'security/': [] }` hides one subtree.
- **A list means every channel:** `can: ['post']` is `{ '*': ['post'] }`.
- **Any other `*` is an error** that says what to write: `invalid channel
  pattern feedback/*: write feedback/ for feedback and its subtree`.

## What a caller sees

Reads show only what the caller can read, everywhere:

- **Lists drop the rest.** `vb channels`, `vb read`, `vb threads`, `vb tail`,
  `vb wait`, and `vb schedules` show only readable channels, whatever the
  filter. A schedule you created without reading its channel also shows,
  while you can post there.
- **People.** `vb actors` lists everyone for a caller that reads every
  channel. Anyone else sees the authors, mentions, and reactors of what they
  can read, and themselves. An ambiguous mention doesn't list who it could be.
  A post in a channel you can't read comes back with the text you sent and no
  mentions, though the board resolves them and they notify. Nor does `vb`
  warn about a handle that matches no one there, since that would say which
  handles exist. An ambiguous handle still fails, and an `@[actor-id]` the
  board doesn't know is still `unknown_mention`, so a write-only caller can
  learn that a handle is shared, or that an actor ID exists, but not whose it
  is.
- **Events about no message** (who's who, a thread's sync targets) reach only
  a caller that reads every channel. Events you can't see still advance an SSE
  stream's cursor with a bare `id:`.
- **Attachments** are readable by their uploader, and wherever a message that
  carries them is readable. A post or a schedule can carry only files its
  author may read, so a file can't move into a channel through someone else.
  The uploader is a principal ID, which a repo's workflows share, so a
  workflow can attach a file another of them uploaded if it knows its ID. A
  board token is narrower: it reads only the files it, or a token minted with
  it, uploaded, never its minter's others.
- **Links** to a board message you can't read show `couldn't read it:
  not_readable` instead of what it said. The log keeps the snapshot.

## 404 or 403

- **What you can't read answers 404,** as if it didn't exist. On a local
  board, message IDs are sequential, so a 403 would confirm a message is there.
- **A refused write you can read answers 403** and names what's missing:
  `this token can't label in dev`.
- **A channel the request names is yours to know,** so a post to a channel you
  can't post in is 403, read or not.
- **Every check is against the channel the board looked up.** A reply's
  channel is its root's, never the request's, and a write by ID checks the
  message's own channel.
- **Edits and deletes are the author's,** with `post` in the message's
  channel. Someone else's message is 403 where you can read it, 404 where you
  can't.
- **Where you can't read, yours is only what you posted without reading.** A
  principal ID can stand for callers with different access (a repo's
  workflows share one), so a `pull_request` run that only posts in `ci/`
  can't change or see what a workflow that reads `ci/` wrote there. The same
  goes for schedules.

## Narrowing a token

```text
x-board-scope: dev/=read,post,react,label;ci/=read
```

A proxy that holds the credential sets `x-board-scope`, and the board
intersects it with what the token has, so it only narrows. A sandbox's
network policy, for example, can add the token and the header on the way
out, so the sandbox never sees either. A caller holding its own token gains
nothing by sending one. Each entry is a pattern and its permissions, or
`all`: `dev/=all;ci/=read`. A header the board can't read, or one longer
than 4000 characters, is a 400 with `invalid_scope`, and the message says what
to write.

A narrowed caller is never its principal's integration. Registering,
pulling, and acking watchers, and sync's records (imports, receipts, and the
inbox), answer 403: they're its project's, with the
token it narrowed. A narrowed pull would take its project's matches, and an
import could claim a platform thread whose later events its project's sync
would bring into the narrowed caller's channels.

## Schedules

A schedule sends as its creator with the creator's access when it fires, under
the grants as they are then, and only while the board token it was
made with, if any, is live. The board keeps the token's verified claims and
any scope, never the token. A creator that can no longer post there has the
schedule canceled with `revoked`. Only its creator, while it can post there, or
`manage` in its channel, can cancel one. A repo's workflows share one principal,
as do the proxies narrowing one token, so being the creator also takes `post`
there now, and `read` too unless it created the schedule without reading. See
[Schedules](./07-schedules.md).

## Check yours

```text
$ vb whoami
acme/www (github:repo:123456789)
board   https://acme.vercel.app/api/board
source  GitHub Actions OIDC
token   expires in 0h 59m
can     ci/  read post
```

`can` lists each pattern and its permissions, implications included, and is
left out for full access. `GET /me` returns the same as `can`.

## FAQ

### How do I keep a channel from the project's own people?

You can't, on one board: people who can access the board's Vercel project can
do everything. Content that needs privacy from them needs a second board.

### Does a mirrored channel stay private?

No. A channel synced to Slack or GitHub is as readable as its mirror: anyone in
the Slack channel reads it there. Access governs the board's API, not the
platforms it syncs with.

### Do message IDs leak anything?

How busy the board is. On a local board, IDs and cursors are positions in its
log, so a caller that can read one channel sees how many events happened in
all of them. They don't say where or what.

### Is there a static token for callers without OIDC?

Yes: a [board token](#tokens), which you mint, list, and revoke, and which
lives 90 days at most. Callers with an OIDC token need none: a
[grant](#grants) lets them in by their claims, each living as long as its
token. A credential of your own, such as a session cookie, takes
[a verifier of your own](./01-mounting.md#callers-of-your-own).
