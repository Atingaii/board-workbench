---
'vboard': minor
---

`github({ adapter: 'github/acme' })` finds the app's bot user ID itself, from GraphQL's `viewer`, so `botUserId` is optional with a Vercel Connect connector.
