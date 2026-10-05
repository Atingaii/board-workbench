---
"vboard": minor
---

Typing indicators for synced threads: `POST /messages/:id/typing`, `board.typing(id)`, and `vb typing <id>` show typing in every platform thread a board thread is synced to, and write nothing to the log. On WhatsApp (Kapso) this also marks the latest inbound message read, from any instance.
