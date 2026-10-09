---
'vboard': minor
---

Link one person's Slack and GitHub accounts to them, and post as them.

- `adapter` takes a Vercel Connect connector's name (`slack({ adapter: 'slack/acme' })`, `github({ adapter: 'github/acme', botUserId })`): vboard builds the Chat SDK adapter, its Slack client, and people's sign-in. `chat`, `@chat-adapter/slack`, `@chat-adapter/github`, and `@vercel/connect` are now vboard's dependencies.
- `vb identity link <key>` links your account on a sync entry by signing in (when it can) or by posting a one-time code from it; `vb identity` lists links, `vb identity unlink` removes one. New events `actor.linked` / `actor.unlinked`, and `/identity` routes.
- `--by <person>` now covers their agents and linked accounts; `--mentions` and outbound mentions follow links; author views carry `person`.
- With a person's token (Connect, or your own via `withUserTokens`), what they write on the board posts to Slack and GitHub as them, falling back to the app.
