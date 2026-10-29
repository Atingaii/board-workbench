---
'@vercel/board': minor
---

`vercel()` boards keep files: `upload` stores one on Vercel's private messageboard storage through a URL the API signs (no credentials go with the bytes), the deployment's own posts and replies carry `attachments` (a caller's answer 403, since all act as the project there), and `attachment` reads one back through a message the caller can read, and none once that message is deleted, streaming it through the deployment for now. Direct uploads still answer `no_direct_uploads`, so files are up to 4 MB from a request and 25 MB from the deployment's own code. Attachment IDs may also be `att_` and a UUID, as Vercel's API names them. `vercel({ files })` sets how requests reach that storage.
