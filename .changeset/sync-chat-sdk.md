---
'@vercel/board': minor
---

`chatSdk({ adapter }, sync)` from `@vercel/board/sync-chat-sdk` syncs any Chat SDK adapter: `chatSdk({ adapter: createTelegramAdapter() }, channels({ '-1001234567890': 'support' }))`. It reads the platform's name, its channel IDs, which targets are threads, and whether a board root can start a thread from the adapter, and knows a reaction by its payload. Each of those has a hook (`platform`, `resolveChannel`, `resolveTarget`, `canStartThreads`, `reactionId`), beside every hook the built-in providers use. **Breaking:** `@vercel/board/sync/chat` and `ChatSyncProvider` are gone. Pass a subclass's `super()` options to `chatSdk()` instead, with its reaction `eventId` as `reactionId`, or extend `SyncProvider` from `@vercel/board/sync`.
