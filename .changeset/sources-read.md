---
'vboard': minor
---

`vb sources` lists the board's sources (sync entries), and `vb sources <key> read <channel|thread|link>` (`GET /sources/:key/read`, `client.readSource`) reads a Slack channel, thread, or message permalink on demand, without syncing or storing it: public channels the app is already in, never joining one, full access only.
