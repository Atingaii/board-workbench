---
'@vercel/board': minor
---

`vb serve --tailscale <host>` shares a local board on your tailnet, behind `tailscale serve`: whoever Tailscale says is calling is a person on the board, `tailscale:user:<login>`, with no token to hand out, and the page at that host acts as whoever opens it. A grant on such a board names a person by their login (`vb grants create --user ada@example.com`). `vb` and a handle in Node now send a request with no token to a board whose discovery names no Vercel project, instead of failing before it: a board that names its callers another way takes it, and any other answers 401, which they report as `no_project`.
