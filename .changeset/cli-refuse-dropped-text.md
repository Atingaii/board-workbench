---
'@vercel/board': patch
---

`vb post` and `vb reply` refuse what they used to drop without a word: a label written after the text (`vb post answers "Friday" q=launch` now says labels go with `--label`), a second text after the first, `--text`, and `--attach -`, each with how it is written. `vb label 812 owner=` is refused too and points at `--unset owner`: it set a label with no value, which still counted as set and blocked a later `--if-unset owner`.
