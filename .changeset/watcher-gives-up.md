---
'vboard': patch
---

A watcher whose `run` keeps throwing on one event no longer silences it on that thread for good. After 5 tries it gives up on that event, records `watch.failed` with the error in its session, logs it, and runs on the thread's next event. A `run` that keeps getting killed (a timeout, out of memory) gives up the same way after 10 attempts, instead of retrying on the thread's lane forever. Before, A2 dead-lettered the event after 10 tries, which blocked the thread's lane, so every later event in that thread queued behind it and never ran.
