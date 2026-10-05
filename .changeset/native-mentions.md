---
"vboard": patch
---

Synced messages render mentions natively, as the spec says: a Slack user as a real `<@U0456>` mention in Slack, a GitHub user as `@login` on GitHub, and anyone else as their plain name. Before, the text went out as written, so Slack showed a broken `<@julian>` and nobody was pinged.
