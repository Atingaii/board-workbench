---
"vboard": minor
---

`board({ middleware: [...] })`: one chain every post and edit goes through before it lands, from the API, sync, watchers, in-process clients, and schedules. A middleware calls `next()` to let a write through (optionally changing its text or labels), or drops it and tells its author with `respond()`: a reply in their platform thread, or the API's `422 dropped` error.
