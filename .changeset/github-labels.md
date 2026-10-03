---
'vboard': patch
---

GitHub sync mirrors a PR's or issue's labels and assignees onto its root as `tag.<label>` and `assignee.<login>` labels, so `vb read issues --label tag.bug` lists issues labeled bug. Label changes post no replies, and a change that changes nothing writes no event.
