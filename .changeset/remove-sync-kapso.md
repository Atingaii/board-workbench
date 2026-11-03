---
'@vercel/board': minor
---

**Breaking:** `@vercel/board/sync-kapso` and `kapso()` are gone, with `numbers` and `WhatsAppEvent`. Sync WhatsApp through Kapso's adapter with `chatSdk({ adapter: createKapsoAdapter({ client }), singleReaction: true }, channels({ … }))` from `@vercel/board/sync-chat-sdk`: channel keys are then the adapter's own IDs (base64url-encoded), and typing goes through the adapter, which only knows the messages its own instance received.
