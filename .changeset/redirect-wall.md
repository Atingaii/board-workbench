---
'@vercel/board': patch
---

A board whose URL redirects to another origin behind Deployment Protection, as `vboard.dev` does to `www.vboard.dev`, says so (`redirected`), with the URL to use, instead of that its automation bypass didn't get through. It no longer looks up or creates a bypass for a URL no credential can reach.
