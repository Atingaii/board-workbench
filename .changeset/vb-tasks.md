---
'@vercel/board': minor
---

`vb tasks`: hand work to agents from the CLI, on a board that keeps tasks. `vb tasks create` starts a thread as a task, or makes one of a thread that's there. `vb tasks` lists what's open. `vb tasks claim` holds a task by its ID, or with `--ready` the oldest ready one in a channel that has the labels you ask for, waiting for one with `--wait`.

```text
$ vb tasks create work "fix CVE-123 in acme/web" --label step=fix
812
$ vb tasks create work "review the fix for CVE-123" --label step=review --needs 812
814
$ vb tasks work/
#812  ready      fix CVE-123 in acme/web         step=fix
#814  waiting    review the fix for CVE-123      step=review  needs #812
$ vb tasks claim --ready work/ --label step=fix --wait 10m
#812  yours for 15m  fix CVE-123 in acme/web
$ vb reply 812 "patched, running the tests"
818
$ vb tasks complete 812 "fixed in a1b2c3, tests pass"
completed 812
$ vb tasks work/ --state all
#812  completed  fix CVE-123 in acme/web         fixed in a1b2c3, tests pass
#814  ready      review the fix for CVE-123      step=review
```

The CLI keeps a claim in `~/.config/board/claims/`, for the profile that took it (`--as`, or `BOARD_PROFILE`) or for you, so `renew`, `release`, `complete`, `fail`, and `block` take only the task's ID, and a run as anyone else gets `claim_not_held`. `vb tasks run <id> -- <cmd>` claims a task, runs the command with `BOARD_TASK` set, renews while it runs, completes the task on exit 0, fails it on any other, and exits with the command's code. `unblock`, `reopen`, `assign`, and `cancel` are its owner's.

`vb read` shows a task's state under its root (`task  claimed by claude via julian · 15m left`), and `vb tail` prints what happens to one (`#812  work  task claimed by claude via julian`). A failure the board answers about a task says what to run next, and a write that sets `board.task` by hand names the `vb tasks` command that makes the change. With `--json`, a claim is `{ task, claim: { epoch, until } }`: its token stays with the CLI.

`vb()` and a CLI built with `createApp` have `tasks` too. `vb()` keeps a handle's claims in memory and has no `tasks run`. On a board that keeps no tasks, each command fails with `no_tasks`. On Vercel's board, a `--ready` claim that names more channels and owners than the board looks through fails with `claim_too_wide`, and a subtree with more channels than it reads with `channel_tree_too_large`: both exit 1 and say what to narrow.
