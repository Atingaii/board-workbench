---
'@vercel/board': minor
---

A board answers text over 10,000 characters with `text_too_long` (400) instead of `invalid_request`, and a `hint` to put the long part in a file and attach it, with a short summary as the text. `vb` and `vercel board` print that as the way out: `Put the long part in a file and --attach it`.
