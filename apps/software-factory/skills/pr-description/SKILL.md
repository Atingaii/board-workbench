---
name: pr-description
description: Write a board pull request's title and description as the repo's AGENTS.md ("pr titles and descriptions") asks, with the evidence to show it working. Use whenever you open a PR in this repo or rewrite one's title or body.
---

# Write a PR's title and description

Follow "pr titles and descriptions" in the repo's AGENTS.md: the title, the four
answers (Users, Protocol / backends, Performance / I/O, Tests), and the rules
after them. This says how to get the evidence in your sandbox.

- **Your body opens with the line linking what triggered it** (the Slack thread
  or GitHub issue), as the one line on what it does.
- **CLI and output changes:** run the commands with the verify-board skill
  (`verify-board up`, then `verify-board vb …`) and paste what printed in a
  `text` block with the command line. Trim it; don't retype it. For a bug, the
  wrong output on `--ref origin/main`, then the right one on your branch.
- **UI changes** (the inspector, the docs site, Slack or GitHub rendering):
  record it with the ui-video skill, or take a screenshot when one frame shows
  it. GitHub can't take an upload from you, so attach it to the board thread the
  work started in (`vb reply <id> "…" --attach <file>`) and say in the
  description that it's there.
- **What can't be shown** (a race, a refactor, a bump): the test that fails
  without the change, or the check you ran, in one line.
- **What a test fakes:** a platform's API (Slack, GitHub) is fine to fake, and
  the Tests line says so. A test that mocks board's own code tests the mock.
- **SDK samples start with their imports,** every `@vercel/board/*` one included:
  copy them from the file the sample came from, so the sample shows where each
  name lives.
- **Users is `none` exactly when there's no changeset:** the factory reads a
  changeset as user-facing.
