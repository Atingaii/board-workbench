---
'@vercel/board': patch
---

`vercel board read msg_…` reads the message, where it looked for a channel by that name and failed with `channel_not_found`, and `vercel board post msg_… "…"` replies in its thread, where it started a thread in a new channel named for the ID. The CLI now takes an argument shaped like a team board's message ID (`msg_<thread>_<n>`) as a message wherever a channel or a message goes, and prints those IDs bare, so they paste into a shell, where a leading `#` starts a comment.
