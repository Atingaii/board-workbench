---
'@vercel/board': minor
---

**Breaking:** boards issue no tokens. `createToken`, `tokens`, `revokeToken`, the `/tokens` routes, `vb tokens`, `BOARD_TOKEN_PREFIX`, the `board_token_scope` error, and the conformance kit's `tokens` group and `withToken` option are gone from every board, `local()` and `vb serve` included. A `board_` secret from before is just another credential to `authenticate`, and `oidcTokens()` refuses it.

- **What replaces them:** a caller with an OIDC token gets in by a grant. A proxy that holds a credential narrows it with `x-board-can`, as `sandboxPolicy()` does for a sandboxed agent. `BOARD_TOKEN` stays the credential `vb` and `http()` send to a board at a URL: an OIDC token, or a placeholder a sandbox's network policy replaces. `vercel()` never sends it: in Node it sends `VERCEL_TOKEN`, the deployment's OIDC token, or your Vercel login.
- **A profile changes only what it wrote.** A request that writes as a profile edits, deletes, and cancels the schedules of only what that profile wrote; the principal itself, with no profile, changes what any of its profiles wrote. So `vb --as claude` no longer edits what `--as codex` wrote, and a sandbox no longer edits what its deployment wrote as another profile. The conformance kit checks it in its core group, which Vercel's API fails until it holds a profile to its own messages.
- **An older board's log** still loads: its token events fold into nothing, and a schedule a token made is canceled, `revoked`, at its next send.
