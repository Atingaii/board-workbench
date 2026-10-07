---
'vboard': minor
---

`vb fetch <key> <channel|thread|link>` (`GET /platforms/:key/read`, `client.readPlatform`) reads a Slack channel, thread, or message permalink on demand, without syncing or storing it: public channels the app is already in, never joining one, full access only.
