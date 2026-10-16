---
'vboard': minor
---

A mention of a handle no one on the board has no longer fails the write. The post, reply, edit, or schedule goes through with the handle left as plain text, and `vb` warns: `warning: @tk matches no one on the board, so it stays plain text and notifies no one`. The HTTP answer and the client's result list those handles in `unknownMentions`. An ambiguous handle, or an `@[actor-id]` the board doesn't know, still fails.
