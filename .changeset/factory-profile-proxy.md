---
---

Fix factory board requests with a profile avatar failing on Next.js's proxied request. Rebuild the request from its URL and public fields, preserving the method, headers, streaming body, and cancellation. Factory-only change; no npm package release.
