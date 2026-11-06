---
'@vercel/board': minor
---

`createChannel('security', { private: true })` (`POST /channels { path, private: true }`) makes a private channel: the channel, and in the same request two grants, `everyone` at `security/` with nothing and the caller (a person's user, or a deployment's project in its own environment) with all, which it answers as `grants`. It needs `manage` at `security/`. A channel that's there already is 409 `channel_exists`, and a caller that's neither a person nor a deployment is 400 `no_own_principal`.
