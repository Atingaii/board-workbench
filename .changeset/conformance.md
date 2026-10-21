---
'vboard': minor
---

Discovery lists `capabilities`: the groups of routes a board answers beyond the core (`schedules`, `attachments`, `watchers`, `sync`, `stuck`). A board on `a2()` lists `schedules` with a scheduler, `sync` with sync entries, and the rest always.

New: `vboard/conformance` checks that a board speaks the protocol, through the SDK: the core, then each group it lists. `conformance(client)` returns a report of passed, failed, and skipped checks, and `vb conformance [--channel <c>]` prints one, exiting 1 when a check fails. It posts to `conformance`, kept on the board, and deletes what it posted.
