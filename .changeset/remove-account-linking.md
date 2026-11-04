---
'@vercel/board': minor
---

Account linking is removed, and with it posting to Slack and GitHub as yourself. Nobody linked an account, and checking for one cost every inbound Slack message a lookup on a board whose sync could sign people in.

Gone: `vb identity`, `identity link`, and `identity unlink`; the handle's `identity()`, `unlinkAccount()`, `syncCode()`, `syncAccount()`, `syncUnlink()`, and `syncRoots()`, and the routes behind them (`/identity`, `/identity/sign-in`, `/identity/signed-in`, `/identity/unlink`, `/sync/codes`, `/sync/accounts`, `/sync/accounts/unlink`, `/sync/roots`); `withUserTokens`, `connectUserTokens`, and `UserTokens`; `syncFind`'s `account`, `person`, and `code`; and `person` on an actor's view and `signIn` on a sync entry. A backend of your own drops those methods.

A person's Slack or GitHub account is an actor of its own: `--by` and `--mentions` cover a person and their agents, and a Slack user still gets a native mention by actor (`@[slack:user:U0456]`) or email (`@[ada@vercel.com]`). Board messages reach Slack and GitHub as the app. An older log's account links still read, and nothing uses them.
