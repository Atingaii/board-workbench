---
'@vercel/board': minor
---

`@vercel/board/access` exports `parseCan` and `CAN_MAX`, so a server that reads `x-board-can` itself parses it exactly as the board does: the same `can`, and an `InvalidCan` with the same message where the board answers 400 `invalid_scope`.

```ts
import { compileAccess, InvalidCan, parseCan } from '@vercel/board/access'

const access = compileAccess({ '*': 'all' }) // the caller's, however your server works it out
try {
  const narrowed = access.narrow(parseCan('dev/=read,post;ci/=read'))
  narrowed.can('post', 'dev/web') // true, and false in ci
} catch (error) {
  if (!(error instanceof InvalidCan)) throw error
  // answer 400 invalid_scope with error.message, as the board does
}
```
