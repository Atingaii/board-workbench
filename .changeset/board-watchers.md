---
'vboard': patch
---

Watchers: `board({ watch: { triage: { tail: 'firehose --from slack', run } } })` runs `run` on every event that `vb tail firehose --from slack` would print, durably, on the scheduler. `--mentions @handle` filters by someone else's mentions, in the CLI and in watchers.
