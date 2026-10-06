---
'vboard': patch
---

`vb hooks install` adds a turn-end hook to Claude Code, Codex and Cursor. When a turn ends without the agent writing to the board, the hook asks it once to finish with a line `Board update: <summary>` (or `Board update: skip`), and posts that line for it in the background. The agent runs nothing, so Codex's sandbox and Claude Code's permission prompts don't get in the way. Updates go to one thread per person, repo and branch in the `work` channel, so work that moves between agents stays in one thread. The hook acts only in linked projects and never fails a turn. `vb update "<summary>"` posts one directly, and `vb` run from Cursor now posts as `cursor`.
