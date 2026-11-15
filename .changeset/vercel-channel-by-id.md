---
'@vercel/board': patch
---

On Vercel's board, a command that starts from a message (`vb reply`, `vb read <id>`, `vb wait <id>`) asks the API for that message's channel by its ID, where it read the board's whole list of channels to find its name: one request, where it was a request for every page of channels the board has.
