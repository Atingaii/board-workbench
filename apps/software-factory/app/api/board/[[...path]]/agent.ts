import type { NetworkPolicy, Sandbox } from "@vercel/sandbox";

// Pi, the coding agent, working on a board thread from its own Vercel Sandbox: the
// `pi` CLI with `vb`, `gh`, and git, like a developer at a terminal. Each thread gets
// one sandbox and one Pi session, so a later message continues the same work.
// Credentials are placeholders inside the sandbox; its network policy puts the real
// ones on the wire, so nothing in the sandbox can read them.

/** The board the agent's `vb` talks to. A sandbox can only reach a public one: production. */
const BOARD = "https://vboard-basehub.vercel.app/api/board";
const MODEL = "anthropic/claude-opus-5.5";
/** The first Pi release that knows MODEL on AI Gateway. */
const PI = "@earendil-works/pi-coding-agent@1.0.0";
/** A sandbox stops after this long idle in a turn; its files come back with it. */
const SANDBOX_MS = 45 * 60_000;
const SNAPSHOT_MS = 7 * 24 * 60 * 60_000;

/** Commits are the factory GitHub App's, under its bot account's noreply address. */
const GIT_AUTHOR = { name: "factory-basehub[bot]", email: "336642991+factory-basehub[bot]@users.noreply.github.com" };

/** Who a thread's Pi is on the board: profile `pi`, in that thread's session. */
const piSession = (thread: number) => `thread-${thread}`;

/** Whether a message was written by the Pi working on `thread`. */
export const byPi = (thread: number, by: { profile: string | null; session: string | null }) =>
  by.profile === "pi" && by.session === piSession(thread);

/** What Pi does in a thread: work a firehose thread (bug, feature, question), or review a pull request. */
export type Task = "thread" | "review";

const THREAD = `You own bug reports, feature requests, and questions for vboard (github.com/basehub-ai/vboard, private), a message board library and CLI.
The board is how you talk to people. vb read <id> shows a thread, vb reply <id> "<text>" answers in it (and reaches Slack or GitHub when the thread is synced), vb label <id> k=v labels it. Run vb help for the rest.
A thread's kind label (bug, feature, question) says what it is; judge it yourself from the whole thread too. Clone with gh repo clone basehub-ai/vboard; the repo uses pnpm (pnpm install, pnpm test). Any change you make goes on a branch named pi/<thread id> (never main), in a pull request opened with gh pr create that links the thread, and you reply with the PR link.
For a bug report:
1. Reproduce it with a failing test.
2. If you reproduced it, label the thread reproduced=yes, fix it, and open a PR.
3. If you can't reproduce it, or it isn't a bug, label it reproduced=no and reply with why. If the thread came from a GitHub issue, close the issue with gh issue close and say why there too.
For a feature request: if it's clear what's wanted, build it with tests and open a PR. If it's ambiguous or large, reply with a short plan or your questions first, and build it once someone agrees.
For a question: answer it from the code and docs, pointing at the files. Don't open a PR unless someone asks for one.
When you're told there's new activity in a thread, read it, see what's new since you last replied, and act on it.
Keep replies short, and end each with a list of what you ran.`;

const REVIEW = `You review pull requests for vboard (github.com/basehub-ai/vboard, private), a message board library and CLI.
The board is how you talk to people. vb read <id> shows a thread, vb reply <id> "<text>" answers in it (and reaches Slack and the PR on GitHub), vb label <id> k=v labels it. Run vb help for the rest.
For a pull request (its board thread's root has a pr=owner/repo#N label):
1. Clone with gh repo clone basehub-ai/vboard, then gh pr checkout <N>. Read gh pr view <N> and gh pr diff <N>, and SPEC.md and AGENTS.md for the parts it touches.
2. Run pnpm install and pnpm check. Try the change where you can: a test that should fail without it, or the CLI by hand.
3. Reply in the thread with your review: blocking problems first, each with file:line and why, then smaller suggestions. If it's good to merge, say so plainly.
Don't push, approve, merge, or close the PR: people decide that.
When you're told there's new activity in a thread, read it, see what's new since you last replied, and act on it: answer questions, and review again if new commits landed (gh pr view <N> --json commits).
Keep replies short, and end each with a list of what you ran.`;

const INSTRUCTIONS: Record<Task, string> = { thread: THREAD, review: REVIEW };

const SETUP = `set -e
command -v pi >/dev/null || npm install -g ${PI} vboard pnpm >/dev/null 2>&1
command -v gh >/dev/null || {
  v=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | sed -n 's/.*"tag_name": *"v\\([^"]*\\)".*/\\1/p')
  curl -fsSL "https://github.com/cli/cli/releases/download/v$v/gh_\${v}_linux_amd64.tar.gz" | tar xz -C /tmp
  install "/tmp/gh_\${v}_linux_amd64/bin/gh" /usr/local/bin/gh
}`;

/**
 * One message, once: KEY marks it delivered, so a retried watcher doesn't send it
 * twice. The lock queues it behind a turn that's still running, and the session ID
 * makes it a continuation of everything Pi has done in this thread.
 */
const TELL = `mkdir -p ~/.pi/told
[ -e ~/.pi/told/"$KEY" ] && exit 0
touch ~/.pi/told/"$KEY"
cd ~ && exec flock ~/.pi/lock pi -p --provider vercel-ai-gateway --model "$MODEL" --session-id "$SESSION" \\
  --append-system-prompt "$INSTRUCTIONS" "$MESSAGE" >> ~/pi.log 2>&1`;

/**
 * Real credentials on the way out: the deployment's OIDC token, and the factory GitHub App's.
 * On the board, the policy also sets who Pi is, so nothing in the sandbox can post as anyone else.
 */
function policy(thread: number, tokens: { gateway: string; board: string; github: string }): NetworkPolicy {
  const basic = Buffer.from(`x-access-token:${tokens.github}`).toString("base64");
  return {
    allow: {
      // Pi speaks the Anthropic messages API to AI Gateway, which reads x-api-key.
      "ai-gateway.vercel.sh": [
        { transform: [{ headers: { "x-api-key": tokens.gateway, authorization: `Bearer ${tokens.gateway}` } }] },
      ],
      [new URL(BOARD).host]: [
        {
          transform: [
            {
              headers: {
                authorization: `Bearer ${tokens.board}`,
                "x-board-profile": "pi",
                "x-board-session": piSession(thread),
              },
            },
          ],
        },
      ],
      "github.com": [{ transform: [{ headers: { authorization: `Basic ${basic}` } }] }],
      "api.github.com": [{ transform: [{ headers: { authorization: `Bearer ${tokens.github}` } }] }],
      "*": [],
    },
  };
}

async function sh(sandbox: Sandbox, script: string) {
  const done = await sandbox.runCommand({ cmd: "bash", args: ["-c", script], sudo: true });
  if (done.exitCode !== 0) throw new Error(`sandbox setup failed: ${(await done.stderr()).slice(-500)}`);
}

/**
 * Sends Pi a message about a thread: the first one is its task (a thread to work or a PR to review), later ones say
 * there's news. Pi's sandbox and session for the thread are created on first use.
 * `key` names the message, so telling Pi the same thing twice is a no-op.
 */
export async function tellPi({
  task,
  thread,
  key,
  message,
}: {
  task: Task;
  thread: number;
  key: string;
  message: string;
}) {
  const [{ Sandbox }, { getToken }, { getVercelOidcToken }] = await Promise.all([
    import("@vercel/sandbox"),
    import("@vercel/connect"),
    import("@vercel/oidc"),
  ]);
  const settings = {
    name: `pi-${thread}`,
    runtime: "node24",
    timeout: SANDBOX_MS,
    persistent: true,
    snapshotExpiration: SNAPSHOT_MS,
    env: {
      AI_GATEWAY_API_KEY: "from-the-network-policy",
      VBOARD_URL: BOARD,
      VBOARD_TOKEN: "from-the-network-policy",
      GH_TOKEN: "from-the-network-policy",
    },
  } as const;
  let sandbox = await Sandbox.getOrCreate(settings);
  // Stopped with nothing to resume (its snapshot expired): the thread starts over in a new one.
  if (sandbox.status === "stopped" && !sandbox.currentSnapshotId) {
    await sandbox.delete();
    sandbox = await Sandbox.create(settings);
  }
  // Once per sandbox: a new one has no policy yet, so this runs before any credential is in place.
  await sh(sandbox, SETUP);
  // Fresh tokens with every message, so a thread can pick up again days later.
  const [gateway, board, github] = await Promise.all([
    getVercelOidcToken(),
    getVercelOidcToken({ audience: BOARD }),
    getToken("github/factory", { subject: { type: "app" } }),
  ]);
  await sandbox.update({ networkPolicy: policy(thread, { gateway, board, github }) });
  await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", TELL],
    env: {
      MODEL,
      SESSION: piSession(thread),
      INSTRUCTIONS: INSTRUCTIONS[task],
      KEY: key,
      MESSAGE: message,
      // Over any git config Pi writes: otherwise it picks an identity, and GitHub credits a stranger.
      GIT_AUTHOR_NAME: GIT_AUTHOR.name,
      GIT_AUTHOR_EMAIL: GIT_AUTHOR.email,
      GIT_COMMITTER_NAME: GIT_AUTHOR.name,
      GIT_COMMITTER_EMAIL: GIT_AUTHOR.email,
    },
    detached: true,
  });
}
