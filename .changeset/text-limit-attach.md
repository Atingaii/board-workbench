---
'@vercel/board': minor
---

A board answers text over 10,000 characters with `text_too_long` (400) instead of `invalid_request`, and a `hint` to put the long part in a file and attach it to a message, with a short summary as the text. On Vercel's board too: `board()` checks the text before the API sees it. `vb` and `vercel board` say to `--attach` it, or on an `edit`, to keep the edit short and reply with the file.
