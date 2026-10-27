---
"@vercel/board": patch
---

`board.register()`'s input and `RegistrationView` are unions: `{ url?, watch, sync? }` or `{ path, branch?, watch, sync? }`, never both, so TypeScript refuses a registration with a `url` and a `path`, or a `branch` without a `path`, which the board refused with a 400 already. `RegisterInput` names the input. A request that fails a union is told the closest option's first issue, so these keep saying which field is wrong.
