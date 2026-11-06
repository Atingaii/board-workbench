---
'@vercel/board': minor
---

`vb grants create`, `update`, and `explain` name principals with a flag each, `--user`, `--project`, `--github`, `--oidc`, `--all-users`, `--all-projects`, and `--everyone`, each followed by its modifiers (`--environment`, `--workflow`, `--branch`, `--event`, `--claim`): `vb grants create --github acme/web --workflow ci.yml --can 'ci/=post'`. `--can pattern=permissions` repeats and takes `all` and `none`. `update` takes `--add-<kind>` and `--remove-<kind>`, and `--can`, which replaces the grant's. `explain` prints which grant decides a channel, `security/ wins over *. Closest grant for bob@acme.com: g4 (--user): all.` `vb channels create security --private` closes a new channel to everyone but you. `vb tokens create --can` takes `none` too, and repeats.

The handle does what the CLI does, with the same names: `createGrant`, `updateGrant`, `revokeGrant`, and `explain` take `'none'` at a pattern and give a project without `environments` its production deployments, and `createChannel(path, { private: true })` makes a grant letting you in, one closing the channel to everyone else, then the channel, refusing a path where it or a channel under it is there before it writes anything.
