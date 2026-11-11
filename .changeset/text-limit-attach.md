---
'@vercel/board': patch
---

Text over 10,000 characters is refused before it's sent, from an argument, stdin, or `--text-file`, and the error says to put the long part in a file and `--attach` it, with a short summary as the text.
