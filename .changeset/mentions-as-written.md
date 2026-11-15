---
"@vercel/board": patch
---

Slack gets a mention no one resolved as its author wrote it: `@vercel/board` and a handle nobody has stay text, where they went out as `<@vercel>/board`. Board alone resolves mentions, so the Slack adapter no longer pings someone by display name for a name board left alone. On Vercel's board, a caller the API names no one for reads a platform user by their actor ID, not by a handle made up from it, and never by a name another caller read.
