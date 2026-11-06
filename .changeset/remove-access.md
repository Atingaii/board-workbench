---
'@vercel/board': minor
---

**Breaking:** `board({ access })` is gone, and with it every board that serves callers through another board. `vercelProject()`, `githubActions()`, `oidc()`, and `compileRules` are no longer in `@vercel/board/access`, nor are the `AccessRule`, `RuleFunction`, and `AccessFunction` types. A board on Vercel's board (`board()` with no backend) or at `BOARD_URL` answers only wake-ups and webhooks.

Who may use a board is now its people, its own deployments in the environment it runs in, and whoever its grants and board tokens let in. What to do instead:

- A rule that let in a project's deployments or a GitHub workflow becomes a grant: `vb grants create vercel --claim project_id=prj_… --claim environment=production --can …`, or `vb grants create github --claim repository=acme/web --can ci/=read,post`.
- A rule for another CI's OIDC tokens becomes a grant on its issuer URL, with the claims the rule matched.
- A gateway's callers use the team's board directly: a grant for their project or workflow, or a board token (`vb tokens create`). Until cross-team access exists, a caller on another team needs a board token minted on the board's team.
- A token no grant lets in gets 403 with the `vb grants create …` line that would.

`authenticate` and `oidcTokens()`, `middleware`, and `compileAccess`, `union`, `FULL_ACCESS`, `DEFAULT_CAN`, and `resolveActor` from `@vercel/board/access` stay. A custom backend's `BoardBinding` no longer has `issuers`.
