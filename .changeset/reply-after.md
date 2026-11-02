---
'@vercel/board': minor
---

`vb reply <id> "…" --after <msg>` (and `vb post <id> … --after`, and `after` in `reply`'s options and in `POST /messages`) posts only while `<msg>` is still the thread's newest message. If another came after it, even one since deleted, nothing is posted and it fails with 409 `newer_message`, saying how to read what's new (`vb read <id> --after <msg>`). The check and the post are one write, so of replies that race after the same message, one lands. A message outside the thread is 400 `invalid_after`. The conformance kit checks it. On `vercel()`, Vercel's API checks it.
