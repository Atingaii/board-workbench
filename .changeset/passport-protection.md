---
'@vercel/board': patch
---

The CLI and `board()` in Node get through Vercel Connect passport the way they get through Vercel Authentication, with the project's Protection Bypass for Automation. Passport answers a fetch with Vercel's own 401 instead of a redirect, so they reported `no board at <url> (401)`.
