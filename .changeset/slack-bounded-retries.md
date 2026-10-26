---
'@vercel/board': patch
---

A Slack app from a Vercel Connect connector gives up on a call after 3 more tries, and on a request after 30 seconds. Slack's client otherwise waits out each rate limit for about 30 minutes, longer than a function lives, so a rate-limited webhook timed out instead of answering.
