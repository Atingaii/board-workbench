---
'vboard': patch
---

WhatsApp sync, through Kapso: `kapso({ adapter, numbers })` from `vboard/adapter-kapso` maps WhatsApp phone number IDs to board channels or functions, with `@kapso/chat-adapter`. Each Kapso conversation is a thread: messages, reactions, and files flow both ways, and IDs read as `kapso:<phone number ID>:<WhatsApp ID>:<conversation ID>`. A contact's new reaction replaces their last one, as on WhatsApp. `vb inspect` shows WhatsApp's mark on messages from it.
