---
'vboard': minor
---

`a2({ authenticate })` says who a request is. It's one function, `verifyTokens()` from `vboard/access` by default, and verifiers compose in plain code: each answers null when the request carries nothing it recognizes, and a 401 when its credential fails. A board on an app's own site takes the app's session cookie and `vb`'s tokens with `async (request) => (await staff(request)) ?? (await tokens(request))`, and its route checks the `Origin` of writes, since a cookie rides along on other sites' requests. A host serving many teams' boards passes its own verifier alone, and a function as `access`, which decides for every principal. A host's principals get what their kind does; a board whose verifier is `verifyTokens()` alone takes none. `vercelBlob({ prefix })` lets many boards share one Blob store.
