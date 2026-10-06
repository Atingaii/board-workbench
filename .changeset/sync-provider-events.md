---
"vboard": minor
---

Add a shared, validated sync event envelope and extensible provider classes with a native contract and a separate Chat SDK bridge. Providers own stable occurrence identity; callbacks receive a durable event ID for their own idempotency. Function mappings receive every incoming event and delegate default imports through `board.sync(channel, event, overrides)`. Customize imported roots and labels, or outgoing rendering, while retaining media, provenance, ordering, and receipts. String mappings remain automatic mirrors. All callbacks use the shared event envelope. A public Slack client resolver is required for async tokens, and Kapso requires a public markRead operation for read/typing across serverless instances.
