---
"vboard": minor
---

Linked accounts carry across platforms. A mention of any of a person's actors, such as their GitHub account, renders as the account they linked on the target platform (`<@U0456>` in Slack). A provider's `render` also gets `mention`, the author's native mention there resolved the same way (null when there's none), and `mentionOf(actor)` for any other actor. The default label is unchanged.
