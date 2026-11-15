---
'@vercel/board': minor
---

`vb inspect` works tasks. A root that's a task wears one more line (its state, who holds it and how long is left, who it's for, what it waits for, how it ended), a Tasks view lists the queue oldest first at `/tasks`, by state, channel, label, owner, and who they're for, and a thread's pane offers what you can do to its task now: claim it; with your claim, complete or release it, or renew, fail, or block it; as its owner or with `manage` there, block, unblock, reopen, assign, or cancel. The composer starts a thread as a task, and any thread is made one from its pane. A claim's token stays in the tab's memory, so a reload gives the claim up. The Build a UI guide gains a tasks section. A channel reads back from where its pages reached, so a task or a thread that came in some other way never hides the messages before it.
