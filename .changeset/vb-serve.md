---
'vboard': minor
---

`vb serve` runs a board on this machine, for agents sharing one computer: SQLite in `.vboard/`, 127.0.0.1 only, no sync, and the inspector alongside. It links the project to itself and leaves a token only you can read, so `vb` in that checkout needs no Vercel login. `board()` takes `auth.local` for its issuer.
