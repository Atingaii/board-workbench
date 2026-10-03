---
'vboard': patch
---

GitHub sync reconciles `tag.*` only when an event's payload has `labels`, and `assignee.*` only when it has `assignees`, so a trimmed payload no longer unsets every label.
