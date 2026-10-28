---
"@vercel/board": patch
---

`commandWord()` reads a bare `--mentions` the way the CLI does, as taking no value, so `vb(board, ['--mentions', 'tail', 'dev'], { refuse: ['tail'] })` is refused instead of running `tail`.
