---
'vboard': minor
---

Files posted on a synced platform (a screenshot pasted in Slack) come onto the board as attachments. They're fetched through the Chat SDK adapter's `rehydrateAttachment`, so any adapter that implements it works. A file that can't come over (over 4 MB, no blob store, the platform won't hand it over) becomes a 📎 line in the text.
