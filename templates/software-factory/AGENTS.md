<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# This software factory

A board (`@vercel/board`, read its docs in `node_modules/@vercel/board/docs`) and an eve agent
(`node_modules/eve/docs`) in one Next.js app. When you change it, you may be its own agent,
asked to improve itself: what you change here is how you work.

```bash
pnpm install
pnpm typecheck
pnpm test        # node --test, with Node's type stripping
pnpm build
```

- **The board is the team's, in Vercel's API.** `board()` with no backend: Vercel keeps its
  messages, files, and schedules, and this deployment keeps nothing. It runs the board's sync and
  its watcher, woken through `app/api/board/[[...path]]/route.ts`. Production is on the team's
  default board; a dev server or a preview is on one named `factory-dev`.
- **Each setting lives where it's used.** The board's sync is all in
  `app/api/board/[[...path]]/factory.ts`: its connectors, which channel each repo's PRs and issues
  come into (`repoChannels`; this repo's own go to `dev/factory`), and which Slack channels it
  mirrors. The agent's model, instructions, sandbox, tools, and skills are in `agent/`.
- **Instructions are for every turn, skills for some.** `agent/lib/instructions.ts` holds the
  judgment every turn needs, with a line pointing at each skill; a procedure the agent needs only
  sometimes (reviewing, reproducing a bug, seeing a PR through, demos) is a skill in `agent/skills/`.
- **The board sees the agent only through `wakeAgent` (`agent/lib/wake.ts`).** Its `wake` watcher
  tails `dev/`, so the agent hears every message in `dev` and under it. It hands each wake-up to
  eve's own channel (`agent/channels/eve.ts`, at `/eve/v1`), opening the session with the
  thread's ID as its `operationId` and delivering under the event's cursor as the
  `idempotencyKey`: eve keeps one session per thread and drops a repeat, so there's no store of
  sessions here. A wake-up names only its thread; what the agent may reach on GitHub comes from
  the board's config (`agent/lib/credentials.ts`).
- **The agent acts on the board through the factory's own handle** (`agent/tools/vb.ts`), as this
  deployment under the profile `factory`, so `vb typing` and reads reach Slack through the board's
  sync. The watcher's ID is not the agent's profile: the board never wakes a watcher for its own
  writes, and the agent's check-ins must reach it. The agent's `setup_steps` tool asks the setup
  page's own `/api/launcher/steps`.
- **The setup checks write nothing.** `lib/setup.ts` checks the deployment against what the board
  route syncs and says what to do. A test drives each check through `setup()` against a fake
  network (`test/setup.test.ts`).
- **The page's own routes (`app/api/launcher/`) act as the deployment, so they run only while it's
  protected** (`lib/gate.ts`), and write nothing.
- **Real credentials never enter the sandbox.** `agent/lib/credentials.ts` puts them in its network
  policy, which swaps them in on the way out. Keep it that way.
- **GitHub signs the agent's commits, so there's no signing key.** The sandbox's `git`
  (`agent/lib/git/`, which `agent/sandbox.ts` installs) makes each pushed commit again through GitHub's API.
  `test/git-push.test.ts` runs it against real git and a fake GitHub backed by a bare repo.
- **`package.json`'s `version` is the template release this factory started from.** This repo
  is a copy: it doesn't follow the template on its own.
