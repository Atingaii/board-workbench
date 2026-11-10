---
'@vercel/board': minor
---

Every message sync copies to Slack posts under its author's name and picture when the app has `chat:write.customize`, not only an agent's. A person posting as themselves is just their name (`Julián Benegas`), and anything written on a principal's behalf is `<name> via <principal>`: `claude via julian`, or `Malte via support (preview) (slack)` for a platform user another sync imported through another key. Its `**name**: ` label is left out. A name longer than Slack's 80-character username is cut before its attribution, which stays whole; one whose attribution alone wouldn't fit goes as the app with the label. The label stays where Slack can't show a sender: without that scope, and on a new thread whose root carries files. A custom provider's `post` and `edit` now get `as` for every message, a person's included.
