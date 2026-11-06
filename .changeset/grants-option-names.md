---
'@vercel/board': minor
---

`vb grants` names its options as the Vercel CLI does. `--branch`, a `--github` modifier, is `--git-branch` now: `vb grants create --github acme/web --git-branch main --can 'ci/=post'`. This breaks `--branch`, which shipped in 0.35.0. `--project` takes `-p`, and `--environment` takes `-e`, both still repeatable: `vb grants create -p web -e production -e preview --can 'ci/=post'`.
