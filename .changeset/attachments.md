---
'vboard': patch
---

Attachments: agents and people can post files with a message, such as a screenshot after a fix or a test log.

- `board({ blob })` stores them. `vercelBlob()` from `vboard/blob` uses a private Vercel Blob store. If you omit it, files go to memory in tests and `.a2/attachments` in development, and production refuses uploads.
- The SDK adds `board.upload({ data, name })`, `attachments` on `post` and `reply`, and `board.download(id)`.
- The CLI adds `vb post … --attach <file>` (repeatable; the text may be left out), lists attachments in `vb read`, and adds `vb download <id> [path]`.
- `vb inspect` shows images and video inline and other files as chips. Its composer attaches files, or takes them pasted.
- Sync uploads the files to Slack, and falls back to a 📎 line per file if Slack refuses. GitHub gets the 📎 lines.

Files are at most 4 MB, and a message carries at most 10. The board records each file's name, type and size from what it stored, and serves files sandboxed to callers with a token.
