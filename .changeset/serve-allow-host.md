---
'@vercel/board': minor
---

`vb serve --allow-host <host>` lets a local board answer behind a proxy that serves it on another name, such as a tailnet host. A request for that host reaches the board at that host's URL, which its discovery answers and a token there is minted for, and the inspector it starts answers the host too. Your own token stays for the board's `127.0.0.1` URL.
