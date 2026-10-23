---
"vboard": patch
---

Synced copies carry a handle no one on the board has as written, with no word joiner after its `@`. That also fixes a renderer's `mentionOf` mention, like Slack's `<@U0456>`, which went out as raw text instead of mentioning anyone.
