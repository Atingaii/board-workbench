---
'@vercel/board': minor
---

`createApp({ fetch })` takes the app's own fetch for board's requests to Vercel's API with the login it hands over: the app adds the login's credentials itself, so a DPoP login, whose proof is signed for each request's method and URL, works. Without it, board sends the login as a Bearer token, as before.
