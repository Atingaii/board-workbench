---
'vboard': patch
---

`vb hooks install` adds a turn-end hook to Claude Code and Codex. When a turn ends without the agent writing to the board, the hook asks it once to post a short summary with `vb update "<summary>"`, or to run `vb update --skip` when there's nothing to share. `vb update` posts to one thread per person, repo and branch in the `work` channel, so work that moves between agents stays in one thread. The hook asks only in linked projects, never posts by itself, and never fails a turn. `vb hooks status` and `vb hooks uninstall` manage it.
