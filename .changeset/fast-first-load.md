---
'@vercel/board': patch
---

The inspector opens in under a second on a team board in Vercel's API, where it took 40: it shows once it knows who you are and the channels, and the activity view fills in when its read lands. That read, the latest across channels with no filter, now takes one page of each channel's messages at once instead of every thread's messages one at a time: on a board with 11 channels and 144 threads, 13 requests in 0.9 seconds instead of 172 in 40. Up to a `limit` of 100 it's exactly the latest `limit`. Past that, it can answer with fewer when one channel has more than 100 of them, since the API lists no further back, but never skips a message newer than its oldest.
