---
'@vercel/board': minor
---

`vb channels` on a team board in Vercel's API lists each channel by name, sorted by path, where it showed `0 threads · 0 messages` for every one. Vercel's API counts nothing in a channel, so a board on it now leaves the counts out instead of answering 0, and the inspector shows none there either.

Breaking for code that reads them: `ChannelView`'s `lastIndex`, `messages`, and `threads` are optional, there only where the board keeps them, as `a2()` does.
