---
"vboard": minor
---

Add a shared, validated sync event envelope and extensible provider classes. Opt in to callbacks for every incoming event with `handlerMode: 'all'` and delegate default imports through `board.sync(channel, event, overrides)`. Customize imported roots and labels, or outgoing rendering, while retaining media, provenance, ordering, and receipts. Existing string mappings and legacy callbacks keep their behavior. Supply public SDK client operations for Slack lookups with async tokens and Kapso read/typing across serverless instances.
