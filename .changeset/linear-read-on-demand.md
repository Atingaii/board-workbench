---
'@vercel/board': minor
---

`vb sources linear read` reads Linear on demand, syncing nothing: a project's issues by its link, a team's by its key (`ENG`), or one issue and its comments (`ENG-123`). Each issue shows its state, priority, assignee, project, labels, link, and description. `sources <key> read` takes `--after <cursor>` (`after` in `GET /sources/:key/read`), and a read that has more says where to pick up (`next` in its JSON), so a project with hundreds of issues reads a page at a time.
