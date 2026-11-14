---
'@vercel/board': patch
---

The inspector lists a channel by its threads, from `GET /threads`, 25 at a time by latest activity, with each one's reply count and latest reply: a channel whose newest messages are all replies showed "no messages yet: say something", and now shows its threads. Scrolling up loads the next older page from the last one's `older`. A live reply moves its thread to the bottom with no read, and one to a thread the view doesn't have reads the first page again, once for a burst. On a board without `older`, channels load by messages as before.
