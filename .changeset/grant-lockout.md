---
'@vercel/board': minor
---

**Breaking:** a grant change you couldn't take back is refused. Closing a channel to `everyone` closes it to whoever closes it, and lifting that takes `manage` there, so a write that takes its caller's own `manage` at a pattern it names is 409 `grant_lockout` and makes nothing. Revoking or narrowing the grant that keeps you in is the same. Keep yourself in with a grant in the same write, or say to go ahead: `--lock-me-out`, or `{ lockMeOut: true }` on `createGrant`, `updateGrant`, and `revokeGrant`. Owners are never locked out.

`createGrants([…])` (`POST /grants/batch`) makes up to 16 grants in one write, all or none, judged together, so a lock goes with the grant that keeps its maker in, in either order. `vb grants create --file <path>` makes the grants a JSON file holds, `-` for stdin:

```text
$ vb grants create --file grants.json
created g6  --everyone  security/=none
created g7  --user u_julian  security/=all
```

A backend of your own that keeps grants passes `then` to `checkGrantChange` to judge a lockout, and the conformance kit's `grants` group checks both. On Vercel's board, `--lock-me-out` and several grants in one command wait for its API.
