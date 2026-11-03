---
'@vercel/board': patch
---

`slack()` keeps a message link's snapshot when Slack's unfurl reaches the board before the message itself. The unfurl's edit found nothing to edit and was dropped, so a link to a channel the app isn't in, or to a private one, ended up `not_in_channel` or `private_channel` even though Slack had unfurled it. On a busy board, about half of them arrived first. The board now reads the unfurl from the linking message when it imports that message. A custom provider's `fetchLink(link, linker)` gets that message, by its own IDs, as a second argument.
