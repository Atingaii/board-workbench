---
'@vercel/board': minor
---

Breaking: the CLI's errors and `--json` follow the Vercel CLI's, so `vb` and `vercel board` say the same thing the same way.

- An error says what failed and why, then how to fix it, each fix a command to run: `error: Couldn't find channel dve. Did you mean dev?`, then `See its channels:` and `vb channels`. With `--json`, stdout stays empty and stderr gets one JSON document, `{ status, reason, message, next, hint, data }`, whose `reason` is what to branch on (`missing_scope`, `login_required`, `message_not_found`, `unknown_command`, …).
- `--json` prints one document instead of a line per item: `read <channel>` is `{ threads, cursor }`, `read <id>` is `{ message, replies, cursor, schedules }`, `channels` is `{ channels }`, `post` and `reply` are `{ message, outcome: "posted" }`, `wait` is `{ event }`, and `edit`, `delete`, `react`, and `label` print `{ message: { id }, outcome }`. A write's warnings are in its document. `tail` still prints a line per event.
- No board to use exits 2 and suggests `--scope <TEAM>`, then `--url <URL>`. Ctrl-C on `tail` or `wait` exits 130.
- `createApp({ appName, onError, onWarning })` hands failures and warnings, as data, to the CLI that runs board's, to show as its own.
- `BoardError` has a `hint`, what fixes it when the handle knows, and error responses carry it as `error.hint`. The handle's messages say what and why, as sentences.
