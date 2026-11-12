---
'@vercel/board': patch
---

An edit to a long message syncs on Vercel's board. Sync put the edited text in the inbox event's ID, which Vercel's API refuses past 300 characters, so the webhook answered 500 and the board kept the text from before the edit (a Vercel deployment comment stayed at "Building"). The ID now carries a digest of the text. `local()` refuses an inbox event ID over 300 characters too, as Vercel's API does, the conformance kit pushes an edit of a long message, and a webhook whose event the board refuses answers 200 instead of 500, so the platform stops redelivering it.
