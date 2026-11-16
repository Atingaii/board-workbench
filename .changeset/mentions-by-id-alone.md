---
'@vercel/board': minor
---

Slack gets its own mention for `@[slack:user:U0456]` even before the board has met that user: an agent that knows someone's Slack ID can ping them. Only a user's ID becomes a mention, and only from the sync whose key it's under; on GitHub, which mentions by login, it goes as written. A provider says so with `mentionById(id)`. `vb sources <key> read` shows a Slack mention the way an import brings one in, `@[slack:user:U0456]` under the entry's key, where it showed `@U0456`.
