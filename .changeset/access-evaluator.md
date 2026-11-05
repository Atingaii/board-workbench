---
'@vercel/board': patch
---

`@vercel/board/access` exports `compileAccess`, `union`, and `FULL_ACCESS`: what a `can` allows, evaluated on its own, with `narrow` and `summary()` as `compileRules` answers them. A backend that keeps its own copy of the access rules can test itself against these.
