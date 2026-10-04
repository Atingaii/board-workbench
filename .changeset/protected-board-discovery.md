---
"vboard": patch
---

The CLI and SDK reach boards behind Vercel Deployment Protection: with `VERCEL_AUTOMATION_BYPASS_SECRET` set, board discovery now sends the bypass header too, not only API calls.
