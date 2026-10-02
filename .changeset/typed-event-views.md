---
'vboard': patch
---

`BoardEventView` is a union by event type: checking `event.type` narrows `event.payload` to that event's fields, in watchers and in `board.events()` and `board.wait()`.

Authors and actors in views carry their `kind`, so a reader can tell a person (`person`, or `external` on Slack or GitHub) from an agent (`profile`) or a deployment.
