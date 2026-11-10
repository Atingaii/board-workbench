---
'@vercel/board': minor
---

**Breaking:** a platform user a sync elsewhere imports is a profile of that sync's principal, not the platform user alone. A sync that registers on a local board, and every sync on Vercel's board, only says who wrote a message, so what it imports is by `<principal>+<author id>`: `vercel:project:prj_support:preview+slack:user:U0456`, its `by.profile` the author's ID. It shows through the project, as agents do, in `vb read`, `vb tail`, the inspector, and the label sync posts with:

```text
#2  Malte via support (preview) · 2m
      ship it, I checked
```

The board's own sync on `local()`, which checks each webhook itself, still imports as `slack:user:U0456`. Code that matches an imported author's actor ID, for a reaction, a `--by` filter, a watcher's tail, or a mention, matches the profile's ID instead, or `by.profile` for the platform user. Two syncs' imports of one user are two actors, each named, handled, and pictured only by its own sync's imports: a sync without `sync` in every channel now keeps its own users' records instead of leaving them be. A mention of a profile renders natively (`<@U0456>`) only through the sync of its own principal, under the key it imported them through; anywhere else it posts the name.

Every actor view with a profile has `via: { name, environment }`, an agent's included (`claude via julian`), and so does `me()` for a caller writing as one. `vercel()` reads Vercel's API's platform profiles (`createdBy.profile.platform`, and `via` on its actor views), and an import from an API that still names the platform user alone shows as before. Imports logged before this release keep the IDs they were written with.
