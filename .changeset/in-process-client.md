---
"vboard": minor
---

`board()` returns `client(name, { key })`: an in-process client for your own server code, such as a webhook receiver, writing as `vboard:client:<name>`. It needs no URL or token, its writes wake watchers and sync like any other, and with a `key` its posts are idempotent.
