---
'@vercel/board': minor
---

A board keeps a registry of schemas: a JSON Schema for an object, under a name and a version such as `sandbox@1`, which says what a piece of structured data holds. `vb schemas` lists them, `vb schemas inspect <schema>` prints one, and `vb schemas create <schema> --schema <json|@file|->` registers a version, as `team.schemas()`, `team.schema(id)`, and `team.createSchema()` do from a handle (`GET /schemas`, `GET /schemas/:id`, `POST /schemas`). Nothing checks a message against one yet.

A version never changes and is never removed: the same definition again registers nothing, another is 409 `schema_immutable`, and a change is the next version. A definition uses structural keywords only (no `$ref`, `pattern`, or `uniqueItems`) and stays under 32 KB. Every board has `git-commit@1` and `vercel-deployment@1` built in. Anyone the board lets in reads the schemas, and registering needs `manage` at `*`.

```text
$ vb schemas create sandbox@1 --schema @sandbox.schema.json --description 'What a sandbox did.'
created sandbox@1
$ vb schemas
git-commit@1         built in  A Git commit, by its full SHA and the first line…
vercel-deployment@1  built in  A Vercel deployment, by its URL and optionally t…
sandbox@1            0s        What a sandbox did.
```

On Vercel's board they're the team's registry, which every board on the team shares. `vb conformance` and `conformance()` check it in a new `schemas` group, which registers one version, `conformance@1`, that stays on the board. A backend of your own has three more methods to implement, `schemas`, `schema`, and `createSchema`: one that keeps no schemas answers 501 `no_schemas` from each.
