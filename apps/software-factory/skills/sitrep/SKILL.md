---
name: sitrep
description: Write the team's twice-daily recap of vboard's open PRs and threads, and move each one forward. Use when your thread is a scheduled ":sitrep: Morning recap" or ":sitrep: Evening recap" root, or when someone asks you for a recap or sit rep.
---

# The sitrep

Twice a day (09:00 and 18:00 ART) a schedule posts a root in `dev` that says
only ":sitrep: Morning recap" or ":sitrep: Evening recap", labeled
`sitrep=morning` or `sitrep=evening` (and `kind=task`), and you're the Pi for
that thread. Reply to that root with the recap: `vb reply <root id>`.
Don't `vb post` a new message, and don't repeat the headline: the root is the
headline.

The recap is for landing work and leaving nothing behind, not just listing it.

## 1. Find the last recap

You start from nothing: no earlier run's session or notes. What changed is
everything since the last recap, so find it by its label:

```bash
vb read dev --label sitrep     # every recap thread, old and new
```

The label matches a thread's root and its replies. In a sitrep root, the recap
is the reply its Pi posted; in older ones the root is the recap itself. Take
the newest recap before your root: its time is "since the last recap", and its
items are what to follow up on. If there's none, use the last 24 hours.

## 2. Check GitHub, every run

Run `gh pr list --repo vercel-labs/vboard --state open` yourself, every time.
Don't carry over what an earlier recap said about GitHub access: an error
from another run says nothing about yours. If gh does fail, quote the
error it printed (status and message) in the recap, in one line. When gh fails,
find the open PRs from the board instead: the PR threads (`vb read dev --label pr`,
the root labeled `pr=vercel-labs/vboard#<n>` with its state label) and the
`pi/` branches (`git branch -r` in a clone).

## 3. Move each one forward

Before you post, read each open PR's board and Slack threads, and the open
threads in `dev` from the last few days. For each one:

- Answer what you can, and push fixes for blockers you can resolve.
- In the thread itself, ping the one person whose answer or review unblocks
  it, and say exactly what you need.
- When GitHub works, merge what is approved and green, and close PRs that are
  clearly dead or superseded. When it doesn't, list those under "Ready to merge"
  or "Left behind" and say in one line that you couldn't merge or close them.
- Anything nobody is moving is left behind: say what you propose (close it, or
  who should pick it up).

## 4. Write it

List every open PR of vercel-labs/vboard, drafts and RFCs included, even when
nothing changed: none may drop out of the recap while it's open.

- A PR: `:pr: [#<n> <title>](<pr url>) · [Slack thread](<slack thread url>) cc @<owner> — <status>`.
  Take the Slack link from the "From …'s Slack thread" line at the top of the
  PR body, or else from the board threads of the PR and of any issue it links:
  when one of them has replies synced from Slack, link that Slack thread. Leave
  out the "· [Slack thread]" part only when none of them has one.
- A thread without a PR: `:slack: [<summary>](<slack thread url>) cc @<owner>`,
  with the summary as the link, never a bare url.
- Put the @ on the owner in every line, even when one person owns several (a
  bare "cc JB" notifies nobody), and never put a colon right after a handle:
  it stops being a mention.
- Link every PR and issue number you write, never a bare number:
  `[#<n>](https://github.com/vercel-labs/vboard/pull/<n>)` or `.../issues/<n>`
  (check which it is). Board numbers are not GitHub numbers: leave them as they are.

Lay it out for scanning: short bold section headers, each followed by a
markdown list ("- " per item), and a blank line between sections. These
sections, in this order, leaving out any that would be empty:

1. **Ready to merge**: approved and green, needs only a merge.
2. **Needs your call**: a person has to decide something. Put the question in the item.
3. **Waiting on review**
4. **Drafts and RFCs**
5. **Left behind**: stale PRs and threads, each with your proposal. PRs
   untouched for days can share one "Stale since …" line.
6. **Threads without a PR**
7. **Merged and closed since the last recap**: plain lists of linked numbers.
   Look them up, since you weren't there:
   `gh pr list --repo vercel-labs/vboard --state merged --search "merged:>=<last recap's time>"`,
   and `--state closed --search "closed:>=<…>"` for the closed ones. When gh fails,
   use the `state` label on the board's PR roots (`vb read dev --label pr`).

Each PR or thread goes in exactly one section, on one line, with the status
after the "—" short enough to read at a glance. Put a blank line before the
footer, and end with:

`_Twice-daily recap (09:00 and 18:00 ART), from the sitrep skill_`
