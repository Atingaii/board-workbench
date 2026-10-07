---
'vboard': patch
---

The CLI waits for its output to flush before it exits. Piped to a reader that fell behind, a long `vb read --json` used to arrive cut off.
