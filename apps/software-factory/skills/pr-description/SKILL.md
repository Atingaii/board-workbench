---
name: pr-description
description: Write a vboard pull request's description, putting what changes for vboard's users first and showing the change working, not just describing it. Use whenever you open a PR in this repo or rewrite one's body.
---

# Write a PR description

People read the description before they read the code, mostly on Slack and in
the board thread, so it has to say up front what changes and show that it works.

## 1. Lead with what changes for vboard's users

If the PR changes vboard itself (`packages/vboard`) in a way people will
notice, that comes first, before the reason or the internals:

- **What they'll see:** the new or changed command, flag, output, SDK call, or
  HTTP route, written as they'd use it (`vb read dev` now prints one summary per
  thread).
- **Breaking changes** get their own bold line, saying who breaks and what to do
  instead: **Breaking for scripts:** `vb read <channel> --json` prints one
  `{ message, replies, last }` per line; read a thread's messages with
  `vb read <id> --json`.
- **New surface** (a route, an SDK method, a flag, a config option) gets
  named once with its shape.

When it changes nothing users see (the factory app, tests, docs, a refactor),
say so in the first line: "No change to vboard for users: …". The two go
together with the changeset: a change users notice has one (`pnpm changeset`),
and one that doesn't has none: the factory reads a changeset as user-facing.

Then a line or two on why (the bug, or who asked, linking the thread or
issue), and anything a reviewer should look at closely. Skip a file-by-file
walkthrough: the diff has it.

## 2. Show it working

If a bug or a feature can be tried by hand and seen, the description must show
it. Saying "tested locally" doesn't count.

- **CLI and output changes:** run the commands with the verify-vboard skill
  (`verify-vboard up`, then `verify-vboard vb …`) and paste what printed, as is,
  in a `text` block with the command line. Trim it, but don't retype it. For a
  bug, show the wrong output on `--ref origin/main`, then the right one on your
  branch.
- **UI changes** (the inspector, the docs site, Slack or GitHub rendering):
  record it with the ui-video skill, or take a screenshot when one frame shows
  it. GitHub can't take an upload from you, so attach it to the board thread the
  work started in (`vb reply <id> "…" --attach <file>`) and say in the
  description that it's there.
- **Errors and edge cases** that the change is about (an old board, a typo, an
  empty result) get shown the same way, one block each.

When it can't be shown (a race, a refactor, a dependency bump), say what you
ran instead in one line: the test that fails without the change, or the check.

## 3. Keep it short

- Plain sentences, the way the team writes in the thread. No headings for a
  three-line PR.
- Each thing once. Don't repeat the title.
- Open questions and tradeoffs go at the end, as their own lines, so a reviewer
  can't miss them. A PR with none says nothing about it.
- Your PR's body opens with the line linking what triggered it (the Slack
  thread or GitHub issue), then the user-facing change.

## Example

````markdown
From board #5203: `--limit` counted messages, so a busy thread hid the older roots.

`vb read dev` now prints one summary per thread, the way Slack shows a channel,
and `--limit` counts threads, so every root shows. `vb read <id>` is unchanged.

**Breaking for scripts:** `vb read <channel> --json` prints one
`{ message, replies, last }` per line. For a thread's messages, `vb read <id> --json`.

New: `GET /threads` → `{ threads: [{ message, replies, last }], cursor }`, also
`board.threads()`.

```text
$ vb read dev
dev · 2 threads · cursor 17

#10  ada · 3m  [kind=bug status=open]
      flaky e2e on checkout: the payment step times out after 30s on CI runners
      2 replies · last #12 codex via ada · 3m

$ vb read dvv
error: no channel dvv: vboard channels lists them
```
````
