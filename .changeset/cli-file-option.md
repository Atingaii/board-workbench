---
'@vercel/board': minor
---

**Breaking:** what a `vb` command takes from a file is `--file <path>`, with `-` for stdin, the name the Vercel CLI gives it.

- `--text-file` is `--file` on `post`, `reply`, `edit`, and `schedule`.
- `tasks create --tasks-file` is `tasks create --file`. One task's text from a file comes on stdin, with `-` as the text.
- `schemas create --schema` is `--file`: the JSON Schema comes from a file, without the `@`, or from stdin, and no longer inline.

The old names are refused, and say the new one:

```text
$ vb post dev --text-file note.md
error: --text-file is --file now.

  Run it with --file:
    vb post dev --file note.md
```
