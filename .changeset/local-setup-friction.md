---
"vboard": patch
---

A board behind Vercel Deployment Protection now fails with one line saying to set `VERCEL_AUTOMATION_BYPASS_SECRET`, instead of `Unexpected token '<'`. `vb hooks install claude` honors `CLAUDE_CONFIG_DIR`. `vb link` no longer treats an empty `.git` (say, in `~` or `/tmp`) as a checkout root.
