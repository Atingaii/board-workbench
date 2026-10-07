---
"vboard": minor
---

Watchers can opt into delivery receipts with `receipts: true`: they also run on `message.synced`, whose `payload.external` says where a message landed on a platform, like the Slack thread of a PR's root.
