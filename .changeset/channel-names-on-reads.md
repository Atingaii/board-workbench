---
'@vercel/board': patch
---

On Vercel's board, a read of one channel (`vb read <channel>`, `vb wait <channel>`, `vb threads <channel>`, `vb schedules --channel`) names the channel to the API by the name you gave, and a message comes with its channel, so neither asks for the channel first: one request fewer for each. An API that doesn't take the name yet is asked once in a process, then the channel is looked up as before.
