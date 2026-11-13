---
'@vercel/board': minor
---

Vercel's deployment comment on a pull request shows in Slack as Vercel's own table (Project, Deployment, Actions, Updated) instead of a list. It's still one message per pull request, replaced in place as Vercel edits its comment, with the deployments Vercel skipped in a line under the table. A sync provider of your own is handed the comment's deployments too (`deployments` in the body of `post` and `edit`), beside the markdown that lists them.
