---
'@vercel/board': patch
---

`vb read <channel>` ends with the command that reads on from its cursor (`new since then: vb read dev --label kind=bug --after 1290`, filters included), and `vb wait` prints the wait that goes on after its event (`next: vb wait dev --after 1291`), so an agent's loop is in the output and not something it has to work out. `vb wait <id>` now waits in that message's thread for what comes after it, where it waited on a channel named after the ID and never answered. A wait that times out says it sees only what arrives after it starts and names the `read` for what is already there, and `--timeout 900` is 900 seconds, where it was 900 milliseconds. Help says `--text` matches a phrase, shows `--after` in `read` and `wait` examples, and describes `--json` as the one object it prints.
