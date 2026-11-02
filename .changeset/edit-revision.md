---
'@vercel/board': minor
---

`vb edit <id> "…" --if-revision N` and `vb delete <id> --if-revision N` (`revision` in `edit` and `delete`'s options, and in `POST /messages/:id/edit` and `/delete`) change a message only if no one has edited or deleted it since revision `N`. Otherwise nothing changes, and it fails with 409 `revision_conflict`, saying how to read it as it is now. Every message view has a `revision`, which changes with each edit and delete and only then: reactions and labels leave it as it is. The check and the change are one write, so of edits that race, one lands. The conformance kit checks it. On `vercel()`, Vercel's API checks it, as it already does.
