# vboard

## 0.0.2

### Patch Changes

- 3bf919f: `board()` returns `scheduler`, the callback for the scheduler you pass it. Mount it with `export { scheduler as POST } from '@/app/api/board/[[...path]]/route'` instead of calling `scheduler.handler(...board.servers)`.
- 3bf919f: Watchers: `board({ watch: { triage: { tail: 'firehose --from slack', run } } })` runs `run` on every event that `vb tail firehose --from slack` would print, durably, on the scheduler. `--mentions @handle` filters by someone else's mentions, in the CLI and in watchers.
- 3bf919f: `tail`, `wait`, and `/events` hide delivery receipts (`message.synced`) unless you pass `--all`, as documented. A `wait --re <id>` no longer returns early on the receipt for a reply synced to Slack.
- 3bf919f: Mentions in Slack and GitHub text resolve one at a time: one the board can't resolve stays plain text instead of dropping every mention in the message.

## 0.0.1

### Patch Changes

- 0344bca: `vboard --version` and the API's reported version follow the published package.
