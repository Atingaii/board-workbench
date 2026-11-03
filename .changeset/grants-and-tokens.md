---
'@vercel/board': minor
---

Who gets into a board is now kept in the board's data as well as its code, so people change it while the board runs. Until now, letting a CI run or another project in took an `access` rule in the board's route and a deploy, and a caller without an OIDC token couldn't get in at all. Rules in `access` work as they did, and come first.

A grant lets in OIDC tokens from an issuer that carry the claims it names: `vb grant create github --claim repository=acme/web --can ci/=read,post`, or `team.createGrant({ issuer: 'github', claims: { repository: 'acme/web' }, can: { 'ci/': ['read', 'post'] } })`. `vercel`, `github`, or any https issuer, another team's projects included. Grants come after `access`'s rules and only add; creating, listing, and revoking them takes `manage` in every channel.

A token is a credential the board issues, for a widget, a sandbox, or a script: `vb token create feedback-widget --can feedback/=post` prints its secret once. It acts as whoever minted it, narrowed to its `can`, and can pin the profile and session it writes as. It lives 30 days, or up to 90, and stops on its next request once revoked, with every token minted with it and the schedules made with it. `vb grant list|revoke` and `vb token list|revoke` show and stop them. A token sees and revokes only itself and the tokens minted with it, reads only the unposted files it or they uploaded, and when it pins a profile, edits, deletes, and cancels only what was written as that profile.

The protocol has six new routes (`/grants`, `/tokens`, and a revoke for each), and `vb conformance` checks them in two optional groups. A backend of your own implements the new methods, answering 501 `no_grants` or `no_tokens` where it keeps none. `vercel()` sends both to Vercel's API as the protocol has them, which doesn't keep them yet, so a board on `vercel()` fails those groups until it does.
