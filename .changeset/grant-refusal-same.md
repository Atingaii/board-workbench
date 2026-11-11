---
'@vercel/board': patch
---

On a local board, a caller that can't list grants gets the same 403 for revoking or updating a grant it can't reach as for one that isn't there: `this token can't revoke g5: it needs manage wherever that grant reaches`. It was told `it needs manage at *` for a missing one, and since grant IDs count up from g1, trying each mapped which grants exist. A caller that may list grants still gets 404 `grant_not_found`, or `revoked: false`, for a missing one.
