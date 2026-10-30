---
'@vercel/board': minor
---

`linear()` roots say the issue's description under its title and link, and carry its properties as labels: `priority=high`, `project=<project>`, `tag.<label>` for each Linear label, and `assignee.<handle>`, as GitHub's labels and assignees are. Each issue event reconciles the properties its payload carries, so unassigning or clearing a priority unsets the label, and a new description edits the root as a new title does. Lifecycle events take an optional `body`, the text under a root's title and link.
