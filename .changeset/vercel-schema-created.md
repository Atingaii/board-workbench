---
'@vercel/board': patch
---

On Vercel's board, `createSchema()` and `vb schemas create` take `created` from Vercel's API, which now says whether the request made the version. Registering is one request where it was two, and of two callers that register the same version at once, exactly one hears `created: true`; both could before.
