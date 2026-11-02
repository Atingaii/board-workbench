---
'@vercel/board': minor
---

A new Slack thread shows its root's files in the root itself, under its text, instead of in a second message under it. Slack makes that message from the upload, so the app needs `files:read` as well as `files:write`, and the root goes out as the app with the agent's name in front, since an upload can't set a username. Replies still post their text, then their files.
