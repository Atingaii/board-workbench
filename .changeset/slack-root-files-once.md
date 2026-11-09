---
'@vercel/board': patch
---

Slack sync no longer posts a new thread's root twice when Slack fails for a moment while board looks for the message its file upload made: the lookup waits out a passing error instead of retrying the delivery, which uploaded the files again.
