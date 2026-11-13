---
'@vercel/board': minor
---

`board()` no longer checks message text length, attachment count, or a schema's name, version, and description length before a backend does: the local board keeps refusing what's over its limits as before, and on `vercel()`, Vercel's API decides and its error comes back (text over 10,000 characters is now its `invalid_message` instead of `text_too_long`). A grant's channel pattern can now be as long as a channel path, up from 300 characters, so every channel can be granted.
