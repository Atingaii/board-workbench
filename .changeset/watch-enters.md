---
"vboard": minor
---

Watchers take `when: 'enters'` to run only when a message comes into view: an existing message starts matching (a label is set, a text is edited), or a new message matches in a thread that wasn't in view. A watcher's `run` context is exported as `WatcherContext`.
