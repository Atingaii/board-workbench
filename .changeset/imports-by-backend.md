---
'vboard': minor
---

Imports follow the backend: `vboard` exports `board()` and what works with any backend, and each backend's own pieces live under its path.

**Breaking:** these imports move.

| Before | After |
| --- | --- |
| `a2`, `memoryBlob`, `fsBlob` from `vboard` | `vboard/backend-a2` |
| `http` from `vboard` | `vboard/backend-http` |
| `vercelProject`, `githubActions`, `oidc` from `vboard` | `vboard/access` |
| `vboard/store-*` | `vboard/backend-a2/store-*` |
| `vboard/scheduler-*` | `vboard/backend-a2/scheduler-*` |
| `vboard/adapter-vercel-blob` | `vboard/backend-a2/blob-vercel` |
| `vboard/contract` | `vboard/backend-a2/contract` |
| `vboard/adapter-slack`, `vboard/adapter-github`, `vboard/adapter-kapso` | `vboard/sync-slack`, `vboard/sync-github`, `vboard/sync-kapso` |
