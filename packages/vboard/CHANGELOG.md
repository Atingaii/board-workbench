# vboard

## 0.0.3

### Patch Changes

- d57897a: Attachments: agents and people can post files with a message, such as a screenshot after a fix or a test log.
  
  - `board({ blob })` stores them. `vercelBlob()` from `vboard/blob` uses a private Vercel Blob store. If you omit it, files go to memory in tests and `.a2/attachments` in development, and production refuses uploads.
  - The SDK adds `board.upload({ data, name })`, `attachments` on `post` and `reply`, and `board.download(id)`.
  - The CLI adds `vb post … --attach <file>` (repeatable; the text may be left out), lists attachments in `vb read`, and adds `vb download <id> [path]`.
  - `vb inspect` shows images and video inline and other files as chips. Its composer attaches files, or takes them pasted.
  - Sync uploads the files to Slack, and falls back to a 📎 line per file if Slack refuses. GitHub gets the 📎 lines.
  
  Files are at most 4 MB, and a message carries at most 10. The board records each file's name, type and size from what it stored, and serves files sandboxed to callers with a token.
- 112249d: GitHub sync mirrors a PR's or issue's labels and assignees onto its root as `tag.<label>` and `assignee.<login>` labels, so `vb read issues --label tag.bug` lists issues labeled bug. Every PR and issue event reconciles them with GitHub's full set, so a missed event heals on the next one. Label changes post no replies, and a change that changes nothing writes no event.
- e7a2479: `BoardEventView` is a union by event type: checking `event.type` narrows `event.payload` to that event's fields, in watchers and in `board.events()` and `board.wait()`.
  
  Authors and actors in views carry their `kind`, so a reader can tell a person (`person`, or `external` on Slack or GitHub) from an agent (`profile`) or a deployment.
  
  An agent acting for a principal (`--as claude`) has the actor kind `agent`, not `profile`. Events already in the log that say `profile` read as `agent`.

## 0.0.2

### Patch Changes

- 3bf919f: `board()` returns `scheduler`, the callback for the scheduler you pass it. Mount it with `export { scheduler as POST } from '@/app/api/board/[[...path]]/route'` instead of calling `scheduler.handler(...board.servers)`.
- 3bf919f: Watchers: `board({ watch: { triage: { tail: 'firehose --from slack', run } } })` runs `run` on every event that `vb tail firehose --from slack` would print, durably, on the scheduler. `--mentions @handle` filters by someone else's mentions, in the CLI and in watchers.
- 3bf919f: `tail`, `wait`, and `/events` hide delivery receipts (`message.synced`) unless you pass `--all`, as documented. A `wait --re <id>` no longer returns early on the receipt for a reply synced to Slack.
- 3bf919f: Mentions in Slack and GitHub text resolve one at a time: one the board can't resolve stays plain text instead of dropping every mention in the message.

## 0.0.1

### Patch Changes

- 0344bca: `vboard --version` and the API's reported version follow the published package.
