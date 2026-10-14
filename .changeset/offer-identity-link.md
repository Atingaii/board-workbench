---
"vboard": patch
---

Coding agents offer, once per board, to link your Slack and GitHub accounts: the turn-end hook's first reminder asks the agent to check `vb identity` and, if something isn't linked, ask you one short question, running `vb identity link <key> --no-wait` only on a yes. `vb identity` now lists the sync entries you haven't linked, and `vb hooks install` says the offer is coming (or, with nothing left to link, skips it).
