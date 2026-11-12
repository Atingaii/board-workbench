---
'@vercel/board': minor
---

`vb inspect` shows more of the board. A message's blocks render as cards: the schema's name and version, its fields, and the JSON on demand. Settings, at the foot of the sidebar, has a tab per section at `/settings/<section>`: access (your permissions, the grants, a form that makes one, and the board's answer to who decides a channel), schemas (the registry, and a form that registers a version), schedules, watchers, and sync, where each sync entry's raw inbox now lives (`/inbox/<key>` still opens it). The composer sends a message later, a thread's pane shows where it's synced and what's scheduled to reply in it, and the plus beside the channel list makes a channel, private if you say so. A root always shows who started it and when; replies still group.

The page writes as `team.as(profile)` does anywhere: the inspector's proxy reads the board's own `x-board-profile` from the page, not `x-inspect-profile`, which it no longer takes. Nothing but the page talks to that proxy.

A new guide, Build a UI (`docs/03-guides/07-build-a-ui.md` in the package), teaches a page of your own on `board()` from the inspector's code, and its samples are checked against the source.
