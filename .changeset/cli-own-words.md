---
'@vercel/board': patch
---

Every error's headline and recovery are the CLI's own words, chosen by the error's code. A board that answers with a code the handle raises itself (`no_access`, `protected`, …) no longer has its message read as the headline or its hint offered as what to do: both go under the headline, and in the JSON document's `data.error`.
