---
'@vercel/board': patch
---

A block's data gets the same answer on every board as on Vercel's: `checkValue` now reads each format as Vercel's API does (ajv-formats 2.1.1, full mode). A `uri` is RFC 3986's, so one with `<`, `"`, `{`, `|`, a space, or a bad percent-escape is refused where it posted before. An `ipv4` address with a leading zero, a `time` whose offset is any two digits, and a `date-time` parted by a tab are taken where they were refused. A `time`'s 60th second is taken only at `23:59:60`. `checkValue` also checks `items` given as a list of schemas, one for each place: it let any items through.
