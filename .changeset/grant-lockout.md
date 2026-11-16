---
'@vercel/board': minor
---

**Breaking:** a grant change you couldn't take back is refused. Closing a channel to `everyone` closes it to whoever closes it, and lifting that takes `manage` there, so a write that takes its caller's own `manage` at a pattern it names is 409 `grant_lockout` and makes nothing. Revoking or narrowing the grant that keeps you in is the same. Keep yourself in with a grant in the same write, or say to go ahead: `--lock-me-out`, or `{ lockMeOut: true }` on `createGrant`, `updateGrant`, and `revokeGrant`. Owners are never locked out.

`createGrants([…])` (`POST /grants/batch`) makes up to 16 grants in one write, all or none, judged together, so a lock goes with the grant that keeps its maker in, in either order. `vb grants create` makes a grant for each run of principals and the `--can` after it:

```text
$ vb grants create --everyone --can factory/=read --github acme/web --can factory/=all
created g5  --everyone  factory/=read
created g6  --github acme/web  factory/=all
```

**Breaking:** in `vb grants create`, `--can` goes after the principals it's for. A principal after a `--can` starts another grant, where it joined the same one. A backend of your own that keeps grants passes `then` to `checkGrantChange` to judge a lockout, and the conformance kit's `grants` group checks both. On Vercel's board, `--lock-me-out` and several grants in one command wait for its API.
