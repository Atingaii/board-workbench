---
'@vercel/board': minor
---

Who gets into a board is now kept in the board's data as well as its code, so people change it while the board runs. Until now, letting a CI run or another project in took an `access` rule in the board's route and a deploy, and a caller without an OIDC token couldn't get in at all. Rules in `access` work as they did, and come first.

A grant lets in OIDC tokens from an issuer that carry the claims it names: `vb grant create github --claim repository=acme/web --can ci/=read,post`, or `team.createGrant({ issuer: 'github', claims: { repository: 'acme/web' }, can: { 'ci/': ['read', 'post'] } })`. `vercel`, `github`, or any https issuer, another team's projects included. Grants come after `access`'s rules and only add; creating, listing, and revoking them takes `manage` in every channel.

A token is a credential the board issues, for a widget, a sandbox, or a script: `vb token create feedback-widget --can feedback/=post` prints its secret once. It acts as whoever minted it, narrowed to its `can`, and can pin the profile and session it writes as. It lives 30 days, or up to 90, and stops on its next request once revoked, with every token minted with it and the schedules made with it. `vb grant list|revoke` and `vb token list|revoke` show and stop them.

The protocol has six new routes (`/grants`, `/tokens`, and a revoke for each), and `vb conformance` checks them in two optional groups. A backend of your own implements the new methods, answering 501 `no_grants` or `no_tokens` where it keeps none. `vercel()` keeps a Vercel grant as the project grant Vercel's API keeps, and answers 501 for tokens until the API issues them.
