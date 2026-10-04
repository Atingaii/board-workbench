---
'vboard': patch
---

Breaking: the exports move. `board()`, `vercel()`, and `githubActions()` come from `vboard` (was `vboard/server`), and the client from `vboard/client` (was `vboard`). Sync adapters are `vboard/adapter-slack` and `vboard/adapter-github` (were `vboard/slack` and `vboard/github`). `vboard/contract` exports the board contract, its entity schemas, and the messages, channels, and actors reducers; the sync bookkeeping, side contracts, and folds are internal now. `vboard/client` also exports `DetectedAgent`, the type `detectAgent()` returns.
