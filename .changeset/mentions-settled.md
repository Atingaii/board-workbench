---
'@vercel/board': minor
---

**Breaking:** a mention is `@[actor-id]`, settled when a message is written. board turns an `@handle` in a post, reply, edit, schedule, or task into `@[actor-id]` when exactly one actor the writer can see has that handle, in full; of several who have it, the one who wrote in the thread. The write's answer says what became of each handle, in `mentions`, and the CLI prints it:

```text
$ vb reply 2 "over to @julian/claude, cc @nobody"
5
mentioned  claude  @julian/claude
warning: @nobody names no one here: it stays text, and mentions no one.
```

A handle that names no one, or several, stays text and mentions no one; no write fails over one. Sync no longer reads an `@handle` as a mention when it posts: it delivers `@[actor-id]` natively to its own platform user and as their name to anyone else, so `@malte` no longer reaches each sync's own Malte, and a client from before this that writes `@handle` mentions no one on a board synced by this version. Write `@[actor-id]`, or the handle in full (`@support/malte`). `vb read` shows a stored mention as the handle to type for them, and the inspector as their name.
