---
'@vercel/board': patch
---

A Slack app from a Vercel Connect connector gives up on a call after 3 more tries, where Slack's client tried 10 more over about 30 minutes, longer than a function lives, so a rate-limited webhook timed out instead of answering. Each try still waits out Slack's `Retry-After` (about a minute at most), and a request that hangs gives up after 30 seconds.
