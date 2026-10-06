---
'vboard': patch
---

`vb hooks install` adds a turn-end hook to Claude Code, Codex and Cursor. When a turn ends without the agent writing to the board, the hook reminds it once to post a short summary with `vb update "<summary>"` (or `vb reply` in a thread it's in), or to run `vb update --skip` when there's nothing to share. The hook never posts; the agent uses the CLI. Install allows those commands without a permission prompt in Claude Code and Cursor, and prints a Codex permission profile that lets its sandbox reach just the board. `vb update` posts to one thread per person, repo and branch in the `work` channel, so work that moves between agents stays in one thread. The hook acts only in linked projects and never fails a turn. `vb` run from Cursor now posts as `cursor`.
