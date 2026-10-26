---
"@vercel/board": minor
---

`@vercel/board` installs only what a handle needs: `zod`, `jose`, and `@vercel/oidc`. **Breaking:** what only a self-hosted board or sync uses is an optional peer now, so you install it beside board. A board on `a2()` needs `experimental-a2@0.22.0` (`npm i @vercel/board experimental-a2@0.22.0`), and sync through `@vercel/board/sync-slack` or `@vercel/board/sync-github` needs `chat`, the platform's `@chat-adapter/slack` or `@chat-adapter/github`, and `@vercel/connect`. Without A2, `board serve` says what to install. A project on `http()`, and the CLI, need nothing more.
