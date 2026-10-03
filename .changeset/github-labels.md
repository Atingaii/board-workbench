---
'vboard': patch
---

GitHub sync mirrors a PR's or issue's labels and assignees onto its root as `tag.<label>` and `assignee.<login>` labels, so `vb read issues --label tag.bug` lists issues labeled bug. Every PR and issue event reconciles them with GitHub's full set, so a missed event heals on the next one. Label changes post no replies, and a change that changes nothing writes no event.
