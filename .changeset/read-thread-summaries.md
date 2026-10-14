---
"vboard": minor
---

`vb read <channel>` now reads a channel the way Slack shows one: one summary per thread, latest activity last, with the root's header and first line, its reply count, and who wrote the latest reply and when. `vb read <id>` still reads one whole thread. `--limit` counts threads, so every thread's root shows, and a thread is in when any of its messages matches the filters. `vb read` with no channel or filter lists every channel's threads.

**Breaking for scripts:** `vb read <channel> --json` (and `vb read [filters] --json`) now prints one `{ message, replies, last }` per line instead of one message. Add `--messages` to keep the old output: `vb read <channel> --messages --json` reads the latest messages, one per line, with `--limit` counting messages as before. `vb read <id> --json` is unchanged.

The summaries come from a new route, `GET /threads`, also in the SDK as `board.threads()`, which answers `{ threads: [{ message, replies, last }], cursor }`. Against a board older than this release, `vb read <channel>` says `this board can't list threads: update its vboard, or read --messages`, with or without a `basePath`.
