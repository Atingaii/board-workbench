---
"vboard": patch
---

Use native Vercel Trusted Sources OIDC for hosted board access, including discovery, without automation bypass credentials. `VERCEL_AUTOMATION_BYPASS_SECRET` still wins when it is set.
Honor supplied tokens before runtime OIDC, keep local person tokens out of the Trusted Sources header, and report missing OIDC setup clearly.
