---
'vboard': minor
---

The CLI and Node SDK get past Vercel Deployment Protection without `VERCEL_AUTOMATION_BYPASS_SECRET`, like `vercel curl`: your Vercel login reads the board's project's Protection Bypass for Automation, creating one if there's none, and caches it per host. The variable still wins when it's set.
