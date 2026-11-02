---
'@vercel/board': minor
---

`linear()` roots say the issue's description under its title and link, and carry its properties as labels: `priority=high`, `project=<project>`, `tag.<label>` for each Linear label, and `assignee.<handle>`, as GitHub's labels and assignees are. A thread a comment opens gets them from Linear's API too. Each issue event reconciles only what its payload says: a property it carries empty is unset (`priority` and `project` by name, so `project-lead` stays), and one it names without its details stays as it was. A new description edits the root as a new title does. Lifecycle events take an optional `body`, the text under a root's title and link.
