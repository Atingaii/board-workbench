---
'@vercel/board': minor
---

`vb conformance` checks more of what sync needs of a board: an inbox that takes a platform event once, leases it out, and takes its ack; an `@sync` match for each message change; `noSync` kept on a post, a reply, and a schedule; and no one found for a platform account nobody linked. A board on `a2()` passes them all. A custom backend that keeps none of these now fails those checks, and a `vercel()` board fails all five until Vercel's API keeps them.
