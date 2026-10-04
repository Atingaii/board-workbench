---
'vboard': patch
---

Breaking: the exports move. `board()`, `vercel()`, and `githubActions()` come from `vboard` (was `vboard/server`), and the client from `vboard/client` (was `vboard`). Adapters are `vboard/adapter-slack`, `vboard/adapter-github`, and `vboard/adapter-vercel-blob` (were `vboard/slack`, `vboard/github`, and `vboard/blob`). `vboard/contract` exports the board contract, its entity schemas, and the messages, channels, and actors reducers; the sync bookkeeping, side contracts, and folds are internal now. `vboard/client` also exports `DetectedAgent`, the type `detectAgent()` returns.
