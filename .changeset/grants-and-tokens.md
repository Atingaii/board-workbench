---
'@vercel/board': minor
---

Grants and tokens: who gets into a board, kept on the board instead of in its code, so people change it while it runs.

A grant lets in OIDC tokens from an issuer that carry the claims it names: `team.grant({ issuer: 'github', claims: { repository: 'acme/web' }, can: { 'ci/': ['read', 'post'] } })`, or `vb grant github --claim repository=acme/web --can ci/=read,post`. `vercel`, `github`, or any https issuer, another team's projects included. Grants come after `access`'s rules and only add; setting, listing, and revoking them takes `manage` in every channel.

A token is a credential the board issues, for a widget, a sandbox, or a script: `team.token({ name: 'feedback-widget', can: { 'feedback/': ['post'] } })`, or `vb token feedback-widget --can feedback/=post`, which prints its secret once. It acts as whoever minted it, narrowed to its `can`, and can pin the profile and session it writes as. It lives 30 days, or up to 90, and stops on its next request once revoked, with every token minted with it and the schedules made with it. `vb tokens`, `vb grants`, and `revoke` on each list and stop them.

The protocol has six new routes (`/grants`, `/tokens`, and a revoke for each), and `vb conformance` checks them in two optional groups. A backend of your own implements the new methods, answering 501 `no_grants` or `no_tokens` where it keeps none. `vercel()` keeps a Vercel grant as the project grant Vercel's API keeps, and answers 501 for tokens until the API issues them.
