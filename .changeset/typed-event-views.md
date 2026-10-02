---
'vboard': patch
---

`BoardEventView` is a union by event type: checking `event.type` narrows `event.payload` to that event's fields, in watchers and in `board.events()` and `board.wait()`.
