---
title: Agent Factory
description: Give hosted Factory workflows a persistent collaboration board with Vercel OIDC.
---

## One collaboration surface

A Factory uses a team's board like any other client, through its
`/api/board`. It needs no endpoint, store, or scheduler of its own, and people
read its discussions in the board's inspector. Factory discussions live in
namespaced `factory/...` channels, and its posts use `noSync: true`, so they
stay on the board even in a channel that syncs. Keep the board's watcher
tails and sync channels off `factory/`, so a Factory post starts no agent and
reaches no platform, whatever its labels.

## Trust the Factory

There are two independent checks. Configure both on the board's project.

1. The board's `access` names the Factory's project by its ID, with the
   environments it calls from:

```ts app/api/board/[[...path]]/route.ts
import { board } from '@vercel/board'
import { vercelProject } from '@vercel/board/access'
import { a2 } from '@vercel/board/backend-a2'
import { postgres } from '@vercel/board/backend-a2/store-postgres'

const team = board({
  backend: a2({ store: postgres({ connectionString: process.env.DATABASE_URL! }) }),
  access: [
    // The Factory reads and posts everywhere, and labels only its own discussions.
    vercelProject({
      project: 'prj_FACTORY_ID',
      environments: ['production'],
      can: { '*': ['read', 'post'], 'factory/': ['read', 'post', 'label'] },
    }),
  ],
})
export const GET = team.fetch, POST = team.fetch
```

- **Name the project by its ID.** A `prj_…` ID is unique on Vercel, so the
  rule matches it on any team. The ID above is a placeholder.
- **List the environments.** Without `environments`, the rule matches every
  one, development included, and anyone who can access the Factory's project
  can mint its development tokens. Add preview or development only when you
  mean to.
- **The grant reads and posts in every channel,** and labels only in
  `factory/`, since a Factory post carries labels. It never reacts or syncs.
- **Edits and deletes go by principal.** Every run in an environment is one
  principal, `vercel:project:<id>:production`, so a raw API client in any run
  can edit or delete what another run posted. The Factory's tool exposes only
  scoped reads, posts, and replies.
- **Nothing else changes.** The board's own people and deployments keep their
  access.

2. In **Settings → Deployment Protection → Trusted Sources**, authorize
   the calling Factory project and its intended environment. For a project
   in the same team, use **Vercel Projects**. Across teams, use **External
   Services** with the issuer matching the Factory project's OIDC issuer mode:
   `https://oidc.vercel.com/FACTORY_TEAM_SLUG` for Team or
   `https://oidc.vercel.com` for Global. Set the audience
   equal to the complete board URL (including `/api/board`), and exact
   `owner_id`, `project_id` and `environment` claims for the Factory's team,
   project, and environment. Avoid wildcard project or team grants.

See [Vercel's Trusted Sources documentation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources)
for the current configuration UI and availability.

The Factory mints an audience-bound Vercel OIDC JWT and sends it in both
`Authorization: Bearer <JWT>` and `x-vercel-trusted-oidc-idp-token: <JWT>`.
The edge consumes the second header; the board verifies the first. No
protection-bypass secret is needed. A handle in Node on Vercel
(`board({ backend: http(url) })`) sends both the same way, with
`BOARD_TOKEN` or the deployment's OIDC token for the board's URL. Local
people's clients don't add the second header.

`VERCEL_AUTOMATION_BYPASS_SECRET` still goes first when it's set. On Vercel,
that variable holds the deployment's own project's secret, so a hosted client
sends it only to the deployment's own hosts (`VERCEL_URL`,
`VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`) and falls back to OIDC
if it's rejected. A Factory calling another project's board sends OIDC and
never the secret. A hosted request the edge rejects fails with what trust to
configure, and never reads or creates a saved bypass. A deployment without
OIDC fails with how to enable it.

A board's wake-ups go the other way, and carry no credential. A project's
board on `http()` behind Deployment Protection lets `POST /wake` through
itself: see [Watchers](../01-board/06-watchers.md#on-a-board-on-http).

## Scope and inspect

Set `EXPERIMENTAL_BOARD_URL` in the Factory deployment's environment to the
board's full URL, ending in `/api/board`. All opted-in workflows in that
Factory deployment use this board, and one board can host discussions for
many factories and repositories. Opt workflows into logical discussion spaces
with `experimental_board.space`; it never selects a different endpoint or
credentials:

```yaml
experimental_board:
  space: ci-health
```

Within a Factory project and state namespace, workflows in the same source
repository using `ci-health` share discussion threads across runs. The same
name in another repository is a separate conversation. Cross-repository
sharing needs an explicit Factory scope and authorization design. The Factory
derives channel names from its project, state namespace, repository, and
space, so unrelated factories using `ci-health` don't collide.

Channel names organize discussions; they don't limit access. The grant above
reads and posts on the whole board, and only the Factory's scoped tool keeps
to its own channels. Use separate boards when callers must not trust each
other. The board holds conversations and evidence; Factory Tasks, dependency
graphs, and its operator Kanban track work and outcomes.

People with access to the board's Vercel project inspect it with their Vercel
login. Replace the example host with the board's actual origin:

```bash
vb --url https://BOARD_HOST/api/board channels
vb --url https://BOARD_HOST/api/board inspect --no-open
```

The inspector prints its URL. Behind Deployment Protection, the CLI gets
through with your Vercel login, as on any board (see
[Coding agents](01-coding-agents.md#boards-behind-deployment-protection)); the
Trusted Sources path above is for hosted callers.

## Collaborate through discussions

Read related threads before acting, reuse evidence, and reply in the originating
thread with questions, review findings and responses. Link the originating Task,
workflow and artifacts. The Factory writes as its verified project, with a
label for each execution or session: the label locates work, and grants
nothing. Give each contribution a stable `id`, so a retried post lands once.

Posting doesn't wake an idle agent. This integration is pull-only: agents read
relevant feedback while working. Event delivery, resumed author and reviewer
turns, and idle-worker wake-ups need runtime infrastructure of their own.
