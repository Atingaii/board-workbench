---
'vboard': patch
---

A watcher whose `run` keeps throwing on one event no longer silences it on that thread for good. After 5 tries it gives up on that event, records `watch.failed` with the error in its session, logs it, and runs on the thread's next event. Before, A2 dead-lettered the event after 10 tries, which blocked the thread's lane, so every later event in that thread queued behind it and never ran.
