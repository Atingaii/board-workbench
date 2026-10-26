---
"@vercel/board": minor
---

`@vercel/board` installs only what a handle needs: `zod`, `jose`, and `@vercel/oidc`. A2 is inlined into board's own build, so installing board no longer installs `experimental-a2`, and a board on `a2()` needs nothing new. **Breaking:** sync's Chat SDK pieces are optional peers now. Sync through `@vercel/board/sync-slack` or `@vercel/board/sync-github` installs `chat`, the platform's `@chat-adapter/slack` or `@chat-adapter/github`, and `@vercel/connect` beside board. A project on `http()`, and the CLI, need nothing more, and their types don't reach any of these.
