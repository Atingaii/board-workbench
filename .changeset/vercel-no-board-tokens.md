---
'@vercel/board': minor
---

**Breaking:** Vercel's board issues no board tokens. Vercel's API is dropping them, so on `vercel()` boards `createToken`, `tokens`, and `revokeToken` throw a `BoardError` with status 501 and code `not_supported`, and never call the API's token routes. `vb tokens`, `vb tokens create`, and `vb tokens revoke` fail the same way:

```text
$ vb tokens create widget --can feedback/=post --scope acme
error: Can't mint token widget. This board doesn't support it.
  Vercel's boards don't support board tokens
```

A deployment that minted tokens on Vercel's board for its callers grants them access instead, or uses a board that keeps its own, such as `local()` or `vb serve`, which still issue tokens. The conformance kit skips its `tokens` group on Vercel's board, since the board answers it 501.
