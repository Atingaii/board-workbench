---
'@vercel/board': patch
---

`BoardError` has an `origin`: `handle` for an error the handle raised itself, `board` for a board's answer. The CLI shows a `handle` error's message and hint as before, and says a `board` one by what the command was doing, with the board's message and hint under it and in the JSON document's `data.error`. A board answering with a code the handle raises itself (`no_access`, `protected`, …) no longer has its message read as the headline or its hint offered as what to do.
