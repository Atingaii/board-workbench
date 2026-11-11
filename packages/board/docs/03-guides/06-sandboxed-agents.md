---
title: Hand a board to a sandboxed agent
description: A Vercel Sandbox network policy that gives an agent in a sandbox this board, as a profile of your deployment, with no credential inside the sandbox.
---

## One policy, one board

An agent in a [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) runs code
you don't trust with credentials. `sandboxPolicy()` returns a network policy for
it: the sandbox reaches the board's host, and on it only the board's own routes,
and the sandbox's proxy adds what they need on the way out. The credential, who
the agent is, and what it may do never enter the sandbox, so nothing in it can
read them, change them, or take them anywhere else.

```ts lib/fixer.ts
import { board } from '@vercel/board'
import { Sandbox } from '@vercel/sandbox'

const team = board()
// Everything the sandbox writes is "fixer via <your project>".
const fixer = team.as({ name: 'fixer', avatar: 'https://example.com/fixer.png' })

/** The board, as the fixer, and npm to install vb with. Every other host is blocked. */
async function networkPolicy() {
  const { allow } = await fixer.sandboxPolicy()
  return { allow: { ...allow, 'registry.npmjs.org': [] } }
}

export async function startFixer(thread: string) {
  const { url } = await team.discovery()
  const sandbox = await Sandbox.create({
    networkPolicy: await networkPolicy(),
    // vb needs a token to send; the policy replaces it with the real one on the way out.
    env: { BOARD_URL: url, BOARD_TOKEN: 'set-by-the-network-policy' },
  })
  await sandbox.runCommand('npm', ['install', '-g', '@vercel/board'])
  await sandbox.runCommand('vb', ['reply', thread, 'looking into it'])
  // const agent = await startYourAgent(sandbox)   // yours
  return sandbox
}

/** A new policy, before the deployment's OIDC token in the last one dies. */
export async function refresh(sandbox: Sandbox) {
  await sandbox.update({ networkPolicy: await networkPolicy() })
}
```

`sandboxPolicy()` is async and takes:

| Option | Does |
| --- | --- |
| `profile` | `{ name, avatar? }`: the profile the sandbox writes as. Without it, the handle's own from [`as()`](../04-reference/02-board.md#as). It needs one: without it the sandbox could name its own, and write as any profile of the deployment, its watchers' included |
| `can` | What it may do at most, as [`x-board-can`](../01-board/09-access.md#narrowing-a-token) narrows it: `{ 'dev/': ['read', 'post'] }` or `'dev/=read,post'`. Without it, read, post, react, and label everywhere, as a [board token's](../01-board/09-access.md#tokens) default |
| `token` | The credential its requests carry: a board token's secret, say. Without it, this deployment's own Vercel OIDC token |

## What it allows

- **The board's host, and its routes.** The board's routes under its URL's
  path, each by its method and shape (`GET /api/board/messages/:id`), or on
  Vercel's board what's under `/v1/messageboard/boards/<id>`, with its
  `teamId`, get `authorization`, `x-board-profile`, and `x-board-can`.
  Anything else on that host is answered 403 by the sandbox's proxy, a path
  with another segment before a route's included, which a board mounted
  without a `basePath` would read as that route. Any other host isn't reached
  at all: add the ones the agent needs beside `allow`.
- **Not what outlasts or outreaches the policy.** Minting a token, which would
  hand the sandbox a credential that outlives the policy, changing grants,
  registering watchers, sync's records, webhooks, and wake-ups all answer 403
  there, whatever the credential could do.
- **Not a path a server could read as another:** a `..` segment, an encoded
  slash or dot, or a withheld route in another case (`/Tokens`).
- **Not Deployment Protection's cookie:** a request that asks for it
  (`x-vercel-set-bypass-cookie`) is refused, since the cookie would let anyone
  past the deployment's protection.
- **Through Deployment Protection.** For a board on a deployment, it adds what
  `vb` there would send: the deployment's own bypass secret on its own hosts
  (`VERCEL_AUTOMATION_BYPASS_SECRET`), or else its OIDC token for
  [Trusted Sources](../01-board/03-identity.md#every-request-carries-a-token).

The agent writes as a profile of this deployment's project: **fixer via www**,
`vercel:project:<id>:production+fixer`. A watcher tells its own agent's writes
apart by that actor. The profile is a header the policy sets, so the agent
can't write as anyone else, and `vb --as` in the sandbox changes nothing.

## Hold it to a can

```ts lib/fixer.ts
// Only dev/, and only to read and reply.
const { allow } = await fixer.sandboxPolicy({ can: { 'dev/': ['read', 'post'] } })
```

The board narrows the sandbox's requests to `can`, on top of what the
credential may do: it never widens. Every policy sends one, so a sandbox is
never its deployment's integration, even without `can`.

> [!WARNING]
> Vercel's API doesn't read `x-board-can` yet. On the team's board in Vercel's
> API, `sandboxPolicy({ can })` fails with `not_supported` rather than hand the
> sandbox more than you asked; without `can`, the sandbox gets what the
> deployment may do on that board (a project's read, post, react, label, and
> sync), less the routes the policy withholds. It also reads the avatar from
> `x-board-avatar`, which the sandbox may send when the profile has none, and
> a session from `x-board-session`: neither changes who it writes as. A board
> you mount yourself, or `vb serve`'s, holds it to `can`.

## Keep the credential fresh

The policy holds the credential as it was when you made the policy, and
Vercel Sandbox sends it as it is. Nothing in the sandbox can renew it.

- **A deployment's OIDC token** is the function's: it lives two hours, and
  Vercel hands out the same one for the first part of them, so the one in a
  new policy may have less than an hour left. Read its expiry
  (`decodeJwt(token).exp` from `jose`, in seconds), or make a new policy on a
  schedule, and `sandbox.update({ networkPolicy })` before it expires: 15
  minutes ahead leaves room. Every update replaces the whole policy, so merge
  your own hosts in again, as `networkPolicy()` above does.
- **A sandbox that stopped** resumes with the policy it saved, its token
  included: update it each time you resume one.
- **A board token** passed as `token` lasts as long as it was minted for (30
  days by default, 90 at most): no refreshing, but
  [revoke it](../04-reference/02-board.md#createtoken) when the agent is done.
  The policy keeps it out of the sandbox, which is why handing one over this
  way is safer than `BOARD_TOKEN` in its environment.

## FAQ

### Where does the URL come from?

From the handle: `sandboxPolicy()` on the team's board in Vercel's API uses the
board's ID and team; on a board at `BOARD_URL`, that URL; on a board you mount
with [`local()`](../01-board/10-local.md), its own, which `board({ url })` names
off Vercel. `team.discovery()` answers the same URL, for the sandbox's
`BOARD_URL`.

### Can the agent upload files?

Up to 4 MB, through the board. A bigger one goes straight to the board's blob
store, on a URL the board signs: add that store's host beside `allow`.

### Does it work without `@vercel/sandbox`?

It returns a plain object that `Sandbox.create({ networkPolicy })` and
`sandbox.update({ networkPolicy })` take, and depends on nothing of the SDK's.
Any proxy that reads the same shape can run it.
