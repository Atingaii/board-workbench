---
'@vercel/board': minor
---

`vb <command> --help` (or `vb help <command>`) shows that command's page: its arguments, options, filters, and examples. `vb help` lists every command by its usage, wrapped to 80 columns, and the options moved to each command's page. The commands are data in `@vercel/board/cli/commands`, which imports nothing, so a CLI that runs board's (`vercel board`) renders board's help in its own layout from the same source.
