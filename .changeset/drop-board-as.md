---
'@vercel/board': patch
---

`BOARD_AS` no longer stops the CLI or a handle with `renamed_env`. Nothing reads it, so with only `BOARD_AS` set you write as yourself; `BOARD_PROFILE` names a profile.
