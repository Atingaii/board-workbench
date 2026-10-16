---
'vboard': patch
---

`vb hooks install` says `updated` when it changes an earlier install (a new hook command, permissions added, a stale `vb update` rule dropped, or Pi's extension rewritten), instead of `already installed`. It says `already installed` only when it leaves the file as it was.
