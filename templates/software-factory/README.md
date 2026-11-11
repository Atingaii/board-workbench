# software factory

A board, an agent, and a sandbox that take your team's bugs, features, and questions to pull
requests. Issues and PRs from your GitHub repos, and threads from a Slack channel, come into the
board, and the agent hears every message. It answers questions, reproduces bugs, opens PRs with
fixes and features, reviews every PR, and stays quiet when nothing's for it.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fboard%2Ftree%2Fmain%2Ftemplates%2Fsoftware-factory&project-name=factory&repository-name=factory)

Deploying makes your copy of this repo and a Vercel project, and nothing else: the board is your
team's, in Vercel's API, which keeps its messages, files, and schedules. Then open the deployment:
its page is the launcher. Each step checks the deployment and says what to do:

1. **Vercel.** Vercel Authentication and a Protection Bypass for Automation, the team's board
   (this project let in, and allowed to sync), and AI Gateway (the agent's model).
2. **GitHub.** A Vercel Connect connector whose app is on the repos the factory works on, this one
   included, so the agent can change the factory itself. This repo's PRs and issues come into
   `dev/factory`; map each of yours to a channel in `repoChannels`, in the board's route. A fork's PRs stay
   off the board, and each thread's GitHub token covers only its own repo.
3. **Slack**, optionally. A channel that mirrors the board.
4. **Try it.** Open an issue, or post on the board, and the agent replies.

## How it's built

| Path | What it is |
| --- | --- |
| `app/page.tsx`, `lib/setup.ts` | The launcher, and its checks |
| `app/api/board/[[...path]]/factory.ts` | The board: its sync and its watcher, all configured here. `route.ts` beside it answers Vercel's wake-ups and the platforms' webhooks |
| `agent/channels/eve.ts` | Where the watcher's wake-ups reach the agent, from this deployment only: one eve session per board thread |
| `agent/` | The agent, an [eve](https://www.npmjs.com/package/eve) agent mounted at `/eve/v1` |
| `agent/lib/wake.ts` | What the board sees of the agent: `wakeAgent`, which the board's watcher runs on every message |
| `agent/lib/instructions.ts` | What the agent does on every turn: edit it to change how it works |
| `agent/skills/` | What it does sometimes: `board`, `review-pr`, `reproduce-bug`, `pr-lifecycle`, `ui-demo`, `update-template` |
| `agent/extensions/browser.ts`, `agent/tools/narrate.ts` | A browser in the sandbox, and the voice for the narrated videos of `ui-demo` |
| `agent/instrumentation/otel.ts` | Traces each session with its content, for the project's Agent Runs. Needs a 100% sampling rule: `vercel traces config set 100 --environment any` |
| `agent/schedules/update-template.ts` | A daily check for a new release of this template |
| `agent/lib/git/` | The sandbox's `git`: pushes go through GitHub's API, which signs the agent's commits |

The board only reaches the agent through the watchers it exports, so another agent swaps in by
exporting watchers of its own.

## Locally

```bash
pnpm install
vercel link && vercel env pull   # the project's OIDC token, for AI Gateway and Connect
pnpm dev
```

Locally, and on previews, the board is one named `factory-dev`, which the first run makes on your
team, so nothing you try answers production's threads. Open it with `vb inspect --name factory-dev`.

## Updates

This repo is a copy, not a fork: it doesn't follow the template on its own. Once a day,
`agent/schedules/update-template.ts` compares `package.json`'s `version`, the template release
this factory is on, with the latest. When there's a newer one, it posts a task on the board, and the
agent merges the new release into this repo with the `update-template` skill, keeping your changes.
It opens a PR; nothing merges without a person.
