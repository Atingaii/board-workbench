---
'@vercel/board': minor
---

`vb label <id> owner=claude --if-unset owner` and `vb label <id> state=fixing --if state=open` change labels only while they're as you say (`if` in `label`'s change and in `POST /messages/:id/labels`: a value, or `null` for none). Otherwise nothing changes, and it fails with 409 `label_conflict`, saying what the label is now, so two agents can't both claim a thread. The check and the change are one write, so of writes that race, one lands. The conformance kit checks it. On `vercel()`, Vercel's API checks it.
