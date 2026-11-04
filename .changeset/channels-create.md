---
'@vercel/board': minor
---

Create a channel before anything posts to it: `vb channels create dev/alerts`, `createChannel('dev/alerts')` on a handle, or `POST /channels { path }`. It needs `read` and `post` there, and answers `{ channel, created }`: a channel that's there, made by a post or another create, stays as it is with `created: false`. A first post still makes one. `vb channels` runs `vb channels list`.

Breaking for custom backends: `createChannel` is a new protocol method. On `a2()` it's a `channel.created` event on the board log, and on `vercel()` Vercel's API makes the channel.
