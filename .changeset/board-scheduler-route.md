---
'vboard': patch
---

`board()` returns `scheduler`, the callback for the scheduler you pass it. Mount it with `export { scheduler as POST } from '@/app/api/board/[[...path]]/route'` instead of calling `scheduler.handler(...board.servers)`.
