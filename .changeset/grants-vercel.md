---
'@vercel/board': minor
---

A board on `vercel()` sends grants to Vercel's API in the protocol's shapes: `updateGrant` as `PATCH /boards/:id/grants/:id`, and `explain` as `GET /boards/:id/grants/explain`. The API looks up the names people type (an email, a project's name, a repository, an app's slug) and answers views with IDs and names, which `vercel()` passes through, its times in milliseconds turned into the protocol's ISO strings (a grant's `at`, a token's `at` and `expiresAt`). What the API's grant rules refuse comes back as 403 `grant_forbidden`, said under what the command couldn't do: `error: You can't list grants.` with `listing grants takes manage at *` under it.

A board token on `vercel()` reaches its own board by its ID, and says so when it can't: finding a board by name, or the team's default, is `error: a board token reaches only its own board, by its ID.` (403 `board_token_scope`), and registering watchers with one is `a board token can't register watchers yet.` (403 `board_token_unsupported`). `vb whoami` shows what the token may do and when it expires.

Vercel's board keeps `--github` and `--oidc` grants but doesn't sign in GitHub Actions or other OIDC callers yet: a run's token gets a 401 there until it does, and the CI guide says so.
