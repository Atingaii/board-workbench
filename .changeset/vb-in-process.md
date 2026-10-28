---
"@vercel/board": minor
---

`vb()` from `@vercel/board/cli` runs a vb command on a board handle in-process and returns what the CLI prints (`{ code, stdout, stderr }`), for agents' tools and scripts that would otherwise start a CLI for each call. Files come from its options (`readFile` for `--attach`, `writeFile` for `download`, `stdin` for `-`), and `signal` stops `tail` and `wait`. It runs the CLI's own commands, so the two can't drift.
