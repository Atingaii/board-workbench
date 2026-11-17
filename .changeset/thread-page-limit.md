---
'@vercel/board': patch
---

Reads of threads on Vercel's board ask the API for up to 100 threads a page (`limit`), where they took 25: `vb read` of a long channel, a read filtered by a label or by what messages say, and `vb read` across channels make a quarter of the requests, and `vb read -n 5` asks for 5. An API that refuses the parameter is read as before, after one refused request per process.
