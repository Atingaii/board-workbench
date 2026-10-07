---
'vboard': minor
---

GitHub sync no longer imports Vercel for GitHub's deployment comment as a reply. It labels the PR's root instead, per project: `deploy.<project>=<status>` and `preview.<project>=<url>`, updated as Vercel edits its comment. PR threads and their Slack copies carry no deploy noise, and agents find a preview with `vb read --label preview.<project>`.
