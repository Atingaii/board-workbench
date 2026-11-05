---
'@vercel/board': minor
---

`--text-file <path>` on `vb post`, `reply`, `edit`, and `schedule` takes the message's text from a file, and `--text-file -` from stdin: `vb reply 812 --text-file note.md`. A bare `-` as the text still reads stdin. In `vb()`, it reads through `readFile`, as `--attach` does.
