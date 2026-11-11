---
'@vercel/board': patch
---

`vb --help` shows the options most runs of a command take, in its row of the command list: `post <channel|id> [text] [--label k=v]... [--attach file]...`, `label <id> [k=v]... [--if-unset k] [--unset k]`, `schedules [id] [--by handle] [--all]`, `wait [channel] [--after id] [--timeout 10m]`, and `schedule … (--in 5m | --at time | --every 30m)`. They were only on each command's own page, so a reader of the list asked for what was already there. `download` names its argument `<attachment-id>`.
