---
name: ui-video
description: Record a captioned video of a UI change working in a real browser (agent-browser + ffmpeg) and attach it to a board reply. Use whenever a change touches UI, to show people it works instead of telling them.
---

# Show a UI change on video

When a change touches UI, prefer showing people it works over telling them.
You decide how: a video for a flow people click through, a screenshot when
one still frame shows it, or nothing when there's nothing to see (say so in
the PR instead).

A short screen recording of the flow the change touches, with a caption burned
in for each step ("Signing in with the test account", "The new message shows up
in the thread"). People watch it in Slack, so keep it under a minute and about
one flow.

`agent-browser` drives Chrome. Run `agent-browser --help` (or
`agent-browser <command> --help`) for its commands. `scripts/ui-video` in this
skill's directory handles recording and captions.

## 1. Pick where to test it

Use whichever shows the change best:

- **The PR's preview deployment**, when the change needs real data,
  sign-in or the deployed setup. A factory PR's branch `pi/<thread>` deploys to
  `https://vboard-factory-git-pi-<thread>-vercel-internal-playground.vercel.app`
  (for example `pi-3100`). The sandbox's network policy adds the Vercel
  Authentication bypass to that host, so it opens without signing in to Vercel.
  Other preview hosts still ask for Vercel login, so use a local server for
  them. Wait for the deployment first: `gh pr checks <N> --watch`.
- **A local dev server**, when the change is self-contained, the preview isn't
  ready, or you're working on something with no deployment (`vb inspect`, a
  docs page). Start it in the background
  (`pnpm --filter software-factory dev > /tmp/dev.log 2>&1 &`) and poll it with
  curl until it answers. Hide the framework's dev badge if it gets in the way.

## 2. Rehearse, then record

Do the flow once without recording, so the take has no dead ends. Then:

```bash
agent-browser set viewport 1280 800
agent-browser open <url>
scripts/ui-video start
scripts/ui-video step "Opening the board's thread view"
agent-browser snapshot -i            # find refs
agent-browser click @e12
scripts/ui-video step "Posting a reply with an attachment"
# ... the flow ...
scripts/ui-video step "The reply shows up with its file: it works"
scripts/ui-video stop /tmp/<thread>-<flow>.mp4
```

- Call `step` just **before** each action. A caption shows until the next one,
  and the last one shows until `stop`.
- Write captions as short first-person sentences people can read in about
  2 seconds. Only caption a result ("it worked", "the message is posted") after
  you've checked it on the page with `snapshot`, `get text` or `screenshot`.
  If the flow fails, record the failure and say so in the caption. Don't
  attach a video that claims something the page doesn't show.
- Pause about a second (`sleep 1`) after each action that changes the page,
  so people can see the result.

`stop` burns the captions in and shrinks the mp4 to fit the board's 4 MB
limit. If it says the video is still too big, record a shorter take.

## 3. Check it, then attach it

Grab a frame and look at it before posting:
`ffmpeg -loglevel error -ss 3 -i <video>.mp4 -frames:v 1 -update 1 /tmp/frame.png`.
Then attach the video to the reply that links the PR:
`vb reply <id> "<text>" --attach /tmp/<thread>-<flow>.mp4`.
In the PR body, give the flow you recorded and where (the preview or a local
server) in one line.
