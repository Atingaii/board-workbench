---
'@vercel/board': patch
---

On Vercel's board, a deployment posts and reads blocks. `vercel()` reads the team's schemas through the board (`GET /boards/:boardId/schemas`), which Vercel's API answers to whoever the board lets in. It read the team's own routes before, which answer a project's credentials 403, so `schemas()`, `schema()`, and any post with a block failed from a deployment. Registering a schema there is still for people and apps.
