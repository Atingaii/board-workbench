---
'@vercel/board': patch
---

Reads on Vercel's board name their authors from the read itself where Vercel's API answers a read with its actors (`with=actors`), so `vb read`, `vb threads`, `vb thread`, and `vb tail` make no request for actors. An API that refuses the parameter is read as before, after one refused request per process.
