---
'vboard': patch
---

`vb update --skip`, the command vboard 0.8's turn-end hook suggested, says `vb update` is gone and what to run instead, as `vb update "<text>"` already did, instead of failing on `--skip`. An unknown option on any command is one line naming it: ``error: unknown option: --frob (run `vboard help`)``.
