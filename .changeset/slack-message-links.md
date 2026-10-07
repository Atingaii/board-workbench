---
"vboard": minor
---

Slack message links resolve. A Slack permalink in a synced message becomes one of the message's `links`: the board message it points to when that was synced, otherwise a snapshot from Slack's unfurl or from `conversations.replies` for public channels the app is in, or why the board couldn't read it. `vb read` and `vb inspect` quote linked messages under the message. Reading unsynced links needs the Slack app's `channels:history` scope.
