---
'@vercel/board': minor
---

A board on `vercel()` sends grants to Vercel's API in the protocol's shapes: `updateGrant` as `PATCH /boards/:id/grants/:id`, and `explain` as `GET /boards/:id/grants/explain`. The API looks up the names people type (an email, a project's name, a repository) and answers views with IDs and names, which `vercel()` passes through. Only the board's own code may do these there: a caller it serves is 403, since Vercel's API would see it as the board's project.
