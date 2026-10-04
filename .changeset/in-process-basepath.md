---
'vboard': patch
---

Fix the in-process board client given to watchers and inbound functions when `basePath` is set: it now builds paths under the configured mount instead of failing with `no route`.
