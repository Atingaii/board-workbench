---
'@vercel/board': minor
---

**Breaking:** who writes is now said once, and checked.

- **A profile is one header.** `x-board-profile` is an RFC 8941 structured-field Item: the profile's name, with its avatar as a parameter (`x-board-profile: fixer; avatar="https://example.com/fixer.png"`). The board refuses the old `x-board-avatar` with 400 `invalid_profile`, which names the new form. `as({ name, avatar })`, `--as` with `--avatar`, and `BOARD_PROFILE` with `BOARD_AVATAR` send it. `BOARD_PROFILE` replaces `BOARD_AS`, and a CLI or handle that finds `BOARD_AS` set refuses to run (`renamed_env`) rather than write as you. `vercel()` still sends Vercel's API the name alone and `x-board-avatar`, which it reads today.
- **No sessions.** Who writes is a principal and its profile. The board refuses `x-board-session` with 400, and `by`, `/me`, tokens, and schedules carry no `session`, also for what an older board wrote with one. `vb tokens create --session`, `createToken({ session })`, and `ClientOptions.session` are gone, and a post's client ID is its actor's, whatever session sent it. `vercel()` sends none.
- **No agent detection.** The CLI and a handle in Node read no coding agent's environment (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `GROK_SESSION_ID`, `CURSOR_AGENT`, `PI_*`, `AI_AGENT`): without `--as` or `BOARD_PROFILE`, you write as yourself, so `--human` and the `ambiguous_agent` error are gone. A profile named for a known agent (`claude`) gets no built-in avatar of its own accord: the board still serves the marks at `/avatars/<name>`, for a caller to pass as its avatar. `resolveActor` from `@vercel/board/access` takes no `audience`.
- **Handles come from what verified you.** `--handle`, `BOARD_HANDLE`, `x-board-handle`, and `x-board-name` are gone: the board reads neither header, and a client can't name itself. A host's verifier's handle is its person's handle and name. A Vercel login's development token says only a user ID, so on a board that verifies it (`oidcTokens()`), a person goes by that ID, handle and name, and `vb` no longer asks Vercel for a username to send. A deployment's handle is its project's name in every environment (`support`, not `support@preview`), with the environment in its name (`support (preview)`). Every author a credential named is `verified`, so posts to Slack go out under their names. `vb serve` is always your OS user.

New: `team.sandboxPolicy({ profile?, can?, token? })` returns a Vercel Sandbox network policy that hands the board, and nothing else, to a sandboxed agent. The sandbox's proxy adds the credential (this deployment's own OIDC token, or `token`), `x-board-profile` (the handle's `as()` profile by default; one is required), and `x-board-can` (`can`, or read, post, react, and label everywhere) to its requests for the board's own routes; it withholds routes that mint tokens, change grants, register watchers, or write sync's records, refuses Deployment Protection's bypass cookie, and blocks every other host. Spread its `allow` beside your own hosts. On Vercel's board it refuses a `can`, which the API doesn't read yet. See the guide "Hand a board to a sandboxed agent".

```ts
import { board } from '@vercel/board'

const { allow } = await board().as('fixer').sandboxPolicy()
// await Sandbox.create({ networkPolicy: { allow: { ...allow, 'registry.npmjs.org': [] } } })
```

### Migrating

- A proxy or sandbox network policy that sets `x-board-avatar`: put the avatar in `x-board-profile` instead, `<name>;avatar="<url>"`.
- `BOARD_AS=<name>`: set `BOARD_PROFILE=<name>`.
- A person's own avatar, which `vb` sent from your Vercel account, no longer shows on a local board.
- A coding agent that posted with `vb` and no flags: pass `--as <its name>` (`--as claude`), or set `BOARD_PROFILE`. The board skill tells agents to. Drop `--human`, which is now an unknown option.
- People on a local board that Vercel logins reach show as their user IDs. To show names, verify them with `authenticate` and return each person's handle: a host's verifier's handle stands.
- Mentions and `--by` values that named a deployment `<project>@<env>`: use `<project>`. A watcher or filter matching `user-<id>` handles: match the user ID, or the principal.
- Code that sends `x-board-session` or reads `by.session`: agents that must stay apart write as profiles of their own (`--as fixer-1`), and `by.actor` tells them apart.
