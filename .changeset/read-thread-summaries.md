---
"vboard": minor
---

Add `vb read <channel> --threads`: one summary per thread, by latest activity, with the root's first line, its reply count, and who wrote the latest reply and when. `--limit` counts threads there, so every thread's root shows, and a thread is in when any of its messages matches the filters. It reads `GET /threads`, also in the SDK as `board.threads()`, which answers `{ threads: [{ message, replies, last }], cursor }`. `vb read --json` is unchanged (one message per line); `--threads --json` prints one `{ message, replies, last }` per line, and the CLI reference now documents each command's JSONL shape.
