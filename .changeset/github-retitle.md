---
'@vercel/board': patch
---

A PR or issue retitled on GitHub says its new title on its board root, and the root's copies on other platforms (its Slack line, say) are edited to match. An edit to only the description changes nothing. Sync functions see it as `pr.edited` or `issue.edited`.
