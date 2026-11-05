---
'@vercel/board': patch
---

`@vercel/board/access` exports `compileAccess`, `union`, and `FULL_ACCESS`: what a `can` allows, evaluated on its own, with `narrow` and `summary()` as `compileRules` answers them. It also exports `DEFAULT_CAN`, the `can` a grant or a token gets when it names none. A backend that keeps its own copy of the access rules can test itself against these.
