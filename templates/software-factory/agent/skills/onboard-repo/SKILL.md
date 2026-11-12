---
name: onboard-repo
description: "Bring a repo into the factory: map it to a board channel of its own, with a pull request to this factory's own repo. Use when someone asks you to onboard, add, or start working on a repo."
---

# Onboard a repo

A repo's pull requests and issues come into the board once this factory's own repo maps it to a
channel. Each repo gets a channel of its own, under this factory's.

1. **Check the GitHub app is on it:** `gh api /installation/repositories --jq '.repositories[].full_name'`.
   If the repo isn't listed, say so and stop: someone on the team installs the app on it, and
   the setup page links to where.
2. **Map it**, in `app/api/board/[[...path]]/channels.ts` of this factory's own repo: add
   `"<owner>/<repo>": channel("<name>")` to `repoChannels`, the repo written as GitHub writes it.
   `<name>` is the repo's name as a channel takes it: lowercase letters, digits, `-` and `_`.
   A Slack channel that should mirror it goes in `slackChannels` the same way.
3. **Open the pull request** as for any change, and say in the thread which channel the repo
   will come into.
4. **Once it's merged and deployed,** the repo's new pull requests and issues arrive in that
   channel, and you hear them. Ones opened before that don't come in on their own.
