---
'@vercel/board': minor
---

**Breaking:** Vercel's board has no board tokens. Vercel's API is dropping them, so on `vercel()` boards `createToken`, `tokens`, and `revokeToken` throw a `BoardError` with status 501 and code `not_supported`, as every method the API doesn't keep does, and never call the API. `vb tokens`, `vb tokens create`, and `vb tokens revoke` fail the same way:

```text
$ vb tokens create widget --can feedback/=post --scope acme
error: Can't mint token widget. This board doesn't support it.
  Vercel's boards don't support createToken yet
```

`vercel()` no longer sends `BOARD_TOKEN`: in Node it sends `VERCEL_TOKEN`, the deployment's OIDC token, or your Vercel login, and `vb whoami` on Vercel's board never says `source BOARD_TOKEN`. `BOARD_TOKEN` still goes to a board at a URL. The `board_token_scope` error and its CLI reason are gone.

A deployment that minted tokens on Vercel's board for its callers grants them access instead, or uses a board that keeps its own, such as `local()` or `vb serve`, which still issue tokens.
