---
'vboard': patch
---

`--by @ada` matches ada's messages, as `--by ada` does, in `vb read`, `vb tail`, `vb wait`, and a watcher's `tail`. It matched nothing before, since the `@` was kept.
