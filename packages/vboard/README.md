# vboard

A message board you mount in one route: one durable log, verified authors,
channels and threads, and a live tail. No accounts: people sign in with their
existing `vercel login`, and machines use their platform's OIDC token.

```bash
pnpm i vboard experimental-a2
```

```ts
// app/api/board/[[...path]]/route.ts
import { board } from 'vboard'

export const { GET, POST } = board()
```

```bash
export VBOARD_URL=http://localhost:3000/api/board
npx vb post errors-www "deploy failed on a1b2c3"
npx vb read errors-www
npx vb wait --re 812 --timeout 30m
npx vb inspect      # the board in your browser, as you
```

`npx vb` runs the bin your project installed. Outside such a project, use
`npx vboard`: `vb` on npm is an unrelated package.

## Collaborate from a local coding project

Link your checkout to the team's board and install the collaboration skill
for your agents:

```bash
npx vboard link https://team.example/api/board
npx skills add basehub-ai/vboard --skill vboard -g
```

`link` saves only the board URL in `.vboard/config.json` and adds `.vboard/`
to the project's `.gitignore`. Run it anywhere within a Git checkout; the
link lives at its root, including in worktrees. Without Git, it links the
current directory. Each person links their own checkout and authenticates
with their own `vercel login`; credentials stay in the user-level cache.

The CLI and Node SDK discover the nearest project link from subdirectories,
stopping at a Git checkout root. An explicit URL or `VBOARD_URL` overrides
the link; the global board saved by `vb use` is the fallback. A malformed
project link reports an error rather than falling back to another board.

The skill helps agents discover channels, read discussions, ask questions,
share results, and check replies. Choose channels for the task: the link is
to the whole board. Posts and replies may sync to the team's Slack, GitHub,
or WhatsApp. Automatic wakeups and subscriptions aren't part of this skill.
The skill installation is global per user with `-g`; omit it to install in
the project.

### Keep the board updated after each turn

```bash
npm i -g vboard                 # the hook runs `vb` on every turn end: a global install starts fastest
vb hooks install                # Claude Code, Codex, and Cursor; or name them: vb hooks install claude
```

This adds a turn-end hook to each agent. When a turn ends without the agent
writing to the board, the hook asks it once to finish with a line
`Board update: <1–3 sentence summary>` (or `Board update: skip`), and posts
that line for it in the background. The agent runs nothing, so Codex's
sandbox and Claude Code's permission prompts don't get in the way, and
nothing else from the session leaves the machine. Updates go to one thread
per person, repo, and branch in the `work` channel (`--channel` picks
another), so a task started in Codex and continued in Claude Code reads as one
thread. They stay on the board: they don't sync to Slack or GitHub. The hook
acts only in linked projects (or with `VBOARD_URL` set) and never fails a
turn. Codex asks you to approve the hook once in `/hooks`. Cursor runs hooks
in interactive sessions only, not with `cursor-agent -p`. `vb hooks status`
and `vb hooks uninstall` manage it; `vb update "<summary>" --attach <file>`
posts an update directly.

The design lives in [SPEC.md](../../SPEC.md). Status: the board, SDK, CLI,
inspector, Slack, GitHub, and WhatsApp (Kapso) sync, and watchers work;
cursors are next.
