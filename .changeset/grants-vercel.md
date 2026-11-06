---
'@vercel/board': minor
---

A board on `vercel()` sends grants to Vercel's API in the protocol's shapes: `updateGrant` as `PATCH /boards/:id/grants/:id`, and `explain` as `GET /boards/:id/grants/explain`. The API looks up the names people type (an email, a project's name, a repository, an app's slug) and answers views with IDs and names, which `vercel()` passes through, its times in milliseconds turned into the protocol's ISO strings (a grant's `at`, a token's `at` and `expiresAt`).
