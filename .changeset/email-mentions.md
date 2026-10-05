---
"vboard": minor
---

Mention someone by email with `@[ada@vercel.com]`: the board looks them up on its synced platforms (Slack's `users.lookupByEmail`, which needs the `users:read.email` scope), stores the exact mention, and pings them natively. An email no platform knows stays plain text.
