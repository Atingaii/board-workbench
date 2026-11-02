---
'@vercel/board': minor
---

`vercel()` boards take files up to 100 MB from a client, which sends a file bigger than a request straight to Vercel's storage on the URL the API signs. A direct upload's start takes the file's SHA-256 (`sha256`, base64), which board's client now sends and a board on `a2()` ignores. A caller a `vercel()` board serves whose principal is its own project, as an agent calling with the deployment's token is, may now upload files and post them there too, where it may post. Anyone else still gets 403, since every file there is the project's.
