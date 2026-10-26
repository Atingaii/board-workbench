---
'@vercel/board': minor
---

**Breaking:** the Slack app no longer joins the channels it syncs: `/invite` it to each one. A channel ID routes events and posts without asking Slack anything, so a rate-limited `conversations.info` no longer holds up every webhook on a fresh instance. Until it's invited, a channel's events don't arrive and a post there fails with Slack's `not_in_channel`. The app no longer needs `channels:join`, and `SlackClient` has no `conversations.join`.
