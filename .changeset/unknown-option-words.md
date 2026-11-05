---
'@vercel/board': patch
---

An unknown-option error names the whole argument when one holds several words: `vb read dev "--as x --scope acme"` says `Unknown option "--as x --scope acme"`, where it said `Unknown option --as`, an option `read` takes. Text that starts with `-` and has spaces in it (`vb post dev "- check the deploy"`) now gets the way out that moves it after `--`, where the error named `--` and offered none.
