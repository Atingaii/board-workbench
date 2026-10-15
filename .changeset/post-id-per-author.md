---
"vboard": patch
---

A post's `id` is a retry only for its author: on a board with middleware, someone else's post with an `id` you already used, or yours in another thread, now fails with 409 `duplicate_id` instead of getting back your message. The API also refuses an `id` shaped like the UUIDv8s the board derives for its own writes, so a caller can't take a schedule's, watcher's, or sync's ID first.
