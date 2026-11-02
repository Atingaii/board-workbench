---
'@vercel/board': patch
---

`linear()` drops a root's `assignee.<handle>` and `project` labels once the issue is unassigned or taken out of its project. Linear leaves an empty assignee or project out of the webhook payload rather than sending `null`, so the board kept the old label. An issue whose payload has neither the assignee nor its ID is unassigned, and the same goes for its project, so any later event on an issue with a stale label clears it too. One that names an ID without its details (an `assigneeId` with no `assignee`) still stays as it was.
