---
'@vercel/board': patch
---

`vercel()` names a person by their Vercel username and name, and an agent acting for them as `username/profile`, as Vercel's API does, instead of a handle made from their user ID (`user-zoqgok`). It reads the API's list of who's written when it first names someone, again every five minutes (so a rename shows, once the person writes again and the API records it), and at once when someone new writes.
