---
'@vercel/board': minor
---

`@vercel/board/cli` runs board's CLI inside another one, as `vercel board` will: `createApp({ appName }).run(args)` answers the exit code. Help, usage, and errors use `appName`, and an agent's hook runs it by that name. It has every command but `serve` and `inspect`, so an app that bundles it brings no A2 and no inspector. The CLI also takes your Vercel login from `VERCEL_AUTH_TOKEN`, which the Vercel CLI sets for a CLI it runs, before `vercel login`.
