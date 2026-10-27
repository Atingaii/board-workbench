import type { Sandbox } from "@vercel/sandbox";
import type { WatcherContext } from "@vercel/board";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tokensQueue, tokensStore } from "./a2.ts";
import { CONNECTOR, REPO } from "./github.ts";
import { BOARD, INSTRUCTIONS, MODEL, PI_USER, piName, piSession, policy, TOOLS, type Task } from "./harness.ts";
import { expiresAt, tokenRefreshes } from "./tokens.ts";
import { eveHarness, tellEve } from "./eve.ts";

export { INSTRUCTIONS, piAvatar, piName, piPreview, policy, type Task } from "./harness.ts";

// Pi, the coding agent, working on a board thread from its own Vercel Sandbox: the
// `pi` CLI with `vb`, `gh`, and git, like a developer at a terminal. Each thread gets
// one sandbox and one Pi session, so a later message continues the same work.
// Credentials are placeholders inside the sandbox; its network policy puts the real
// ones on the wire, so nothing in the sandbox can read them.

/** The first Pi release that knows MODEL on AI Gateway. */
const PI = "@earendil-works/pi-coding-agent@1.0.0";
/**
 * What Pi gets on top of its own, written into `~/.pi/agent` every turn from this app's folders of the same names:
 * the ui-video skill, and the computer tool (an extension) it records, the verify-board skill, which runs
 * board on a local board to reproduce and check changes to it, the sitrep skill, and the pr-description skill, for the PRs Pi opens.
 */
const PI_FILES = [
  "skills/ui-video/SKILL.md",
  "skills/ui-video/scripts/ui-video",
  "skills/verify-board/SKILL.md",
  "skills/verify-board/scripts/verify-board",
  "skills/sitrep/SKILL.md",
  "skills/pr-description/SKILL.md",
  "extensions/computer/index.ts",
  "extensions/computer/xinput.py",
];
/**
 * A sandbox session ends at a fixed deadline, not after idling; its files come back with the next one.
 * Each message gets at least this long before it, so a turn that starts late in a session isn't cut off.
 */
const SANDBOX_MS = 45 * 60_000;
const SNAPSHOT_MS = 7 * 24 * 60 * 60_000;
/**
 * The factory GitHub App's token for a sandbox: one that outlives the session it's handed to. Connect
 * caches tokens and by default hands out any with 30s left, so a turn could start with a token that dies
 * minutes in (board thread #2331). A session ends at most SANDBOX_MS after a message, and the next
 * message brings a new token, so one valid for SANDBOX_MS covers it. GitHub's last 60 minutes.
 */
export const GITHUB_TOKEN = { subject: { type: "app" }, validityBufferMs: SANDBOX_MS } as const;

/**
 * Pi's git, with no token of ours: Sandbox git credentials (a private beta, flagged on for this project) start
 * the sandbox as a clone of the repo in /vercel/sandbox, and a broker clones, fetches and pushes for it as the
 * Vercel GitHub App, within the project's bound (`git:write` on the repo). The broker signs each push, with
 * vercel[bot] as author and `__commitAs` as co-author. Smaller sandboxes come from a warm pool that lacks the
 * credential helper, so it takes 6 vCPUs.
 */
const GIT = {
  source: { type: "git", url: `https://github.com/${REPO}.git` },
  resources: { vcpus: 6 },
  __source_credentials: true,
} as const;
const GIT_EMAIL = "pi@vboard-factory.playground-vercel.tools";


/**
 * Whether a message was written by the Pi working on `thread` (named `pi` before it had a name of its own). Every Pi
 * posts as the factory's production deployment, whose OIDC token its network policy adds; its profile and session
 * are headers anyone who can write may send, so they only say which thread's Pi it is.
 */
export const byPi = (thread: string, by: { principal: string; profile: string | null; session: string | null }) =>
  !!process.env.VERCEL_PROJECT_ID &&
  by.principal === `vercel:project:${process.env.VERCEL_PROJECT_ID}:production` &&
  (by.profile === piName(thread) || by.profile === "pi") &&
  by.session === piSession(thread);

/**
 * Whether a message is one of the board's watchers' own notes (a crosspost, `:security:`'s answer, or saying Pi
 * couldn't start), not a person's: it doesn't wake Pi or triage.
 */
export const byWatcher = (by: { actor: string }) => by.actor.startsWith("board:watch:");

/**
 * Whether a message was written by an agent profile (someone's coding agent, like `julian/claude`, or a Pi), not
 * a person: a coding agent sharing its progress in `dev` shouldn't get a kind, and with it, Pi.
 */
export const byAgent = (by: { profile: string | null }) => by.profile !== null;

/** The Slack workspace the factory syncs with. */
const SLACK = "https://vercel.slack.com";

/**
 * Where a thread came from, as a link Pi can put in its PR: a Slack thread's permalink or a GitHub issue or PR.
 * `origin.thread` is the sync target: `slack:C0123:1727000000.123456`, `github:owner/repo:issue:12`, `github:owner/repo:12`.
 */
export function sourceLink(origin: { thread: string } | null | undefined) {
  const thread = origin?.thread ?? "";
  const slack = /^slack:([A-Z0-9]+):(\d+)\.(\d+)$/.exec(thread);
  if (slack) return { platform: "Slack", url: `${SLACK}/archives/${slack[1]}/p${slack[2]}${slack[3]}` };
  const gh = /^github:([^/:]+\/[^/:]+):(issue:)?(\d+)$/.exec(thread);
  if (gh) return { platform: "GitHub", url: `https://github.com/${gh[1]}/${gh[2] ? "issues" : "pull"}/${gh[3]}` };
  return null;
}

/** The task message that starts Pi on a thread, with where it came from when it's synced. */
export function taskMessage(
  task: string,
  thread: { id: string; origin: { thread: string } | null; author?: { name: string } | null },
) {
  const source = sourceLink(thread.origin);
  const by = thread.author?.name ? ` by ${thread.author.name}` : "";
  return `There's ${task} in board thread #${thread.id}${source ? `, posted${by} on ${source.platform}: ${source.url}` : ""}.`;
}

export const SETUP = `set -e
command -v pi >/dev/null || npm install -g ${PI} >/dev/null 2>&1
${TOOLS}`;

/**
 * One message, once: KEY marks it delivered, so a retried watcher doesn't send it
 * twice. The lock queues it behind a turn that's still running, and the session ID
 * makes it a continuation of everything Pi has done in this thread.
 * A `news-` message only says there's something new, and Pi reads what's new itself, so
 * news piled up behind a turn wakes Pi once, for the newest: otherwise each reply (most
 * not for Pi) costs a full turn before the next one, and an ack waits minutes.
 */
export const TELL = `mkdir -p ~/.pi/told
[ -e ~/.pi/told/"$KEY" ] && exit 0
touch ~/.pi/told/"$KEY"
case "$KEY" in news-*) echo "$KEY" > ~/.pi/news ;; esac
cd ~ && exec flock ~/.pi/lock bash -c '
  case "$KEY" in news-*) [ "$(cat ~/.pi/news)" = "$KEY" ] || exit 0 ;; esac
  exec pi -p --provider vercel-ai-gateway --model "$MODEL" --session-id "$SESSION" \\
    --append-system-prompt "$INSTRUCTIONS" "$MESSAGE"' >> ~/pi.log 2>&1`;


/** How much to extend a session ending at `expiresAt` so a turn starting `now` gets SANDBOX_MS: 0 if it already has that. */
export function extension(expiresAt: Date | undefined, now: number) {
  if (!expiresAt) return 0;
  return Math.max(0, SANDBOX_MS - (expiresAt.getTime() - now));
}

/** PI_FILES, as files in Pi's sandbox where pi finds them: scripts executable. */
export async function piFiles(root = process.cwd()) {
  return Promise.all(
    PI_FILES.map(async (file) => ({
      path: `/home/${PI_USER}/.pi/agent/${file}`,
      content: await readFile(join(root, file)),
      mode: file.includes("/scripts/") || file.endsWith(".py") ? 0o755 : 0o644,
    })),
  );
}

async function sh(sandbox: Sandbox, script: string) {
  const done = await sandbox.runCommand({ cmd: "bash", args: ["-c", script], sudo: true });
  if (done.exitCode !== 0) throw new Error(`sandbox setup failed: ${(await done.stderr()).slice(-500)}`);
}

/** How many times a message to Pi is tried before the thread hears Pi couldn't start, and the wait after a first failure. */
const TRIES = 3;
const RETRY_MS = 5_000;

/**
 * Runs `start` until it works, up to TRIES times, and if it never does, says so in the thread instead of throwing.
 * A watcher that throws gets 5 tries in about 15 seconds, then board drops that event without a word in the thread:
 * one bad start (setup hitting GitHub's rate limit) would leave a reply unanswered, with no reason given. Saying so
 * tells the thread, and the next reply tries again.
 */
export async function startOrSay(
  board: Pick<WatcherContext["board"], "reply">,
  thread: string,
  start: () => Promise<void>,
  retryMs = RETRY_MS,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await start();
    } catch (error) {
      if (attempt < TRIES) {
        await new Promise((resolve) => setTimeout(resolve, retryMs * attempt));
        continue;
      }
      console.error(`[factory] Pi couldn't start on board thread #${thread}:`, error);
      const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 200);
      await board.reply(thread, `Pi couldn't start: \`${reason}\`. Reply here to try again.`);
      return;
    }
  }
}

/**
 * Sends Pi a message about a thread: the first one is its task (a thread to work or a PR to review), later ones say
 * there's news. Pi's sandbox and session for the thread are created on first use. If Pi can't be reached, `board`
 * (the calling watcher's) says so in the thread; see `startOrSay`.
 * `key` names the message, so telling Pi the same thing twice is a no-op.
 */
export async function tellPi({ board, ...input }: PiMessage & { board: Pick<WatcherContext["board"], "reply"> }) {
  // Threads the flag gives the eve agent (`agent/`) go there; the rest, and every thread Pi already has, stay with Pi.
  await startOrSay(board, input.thread, () => (eveHarness(input.thread) ? tellEve(input) : deliver(input)));
}

type PiMessage = {
  task: Task;
  thread: string;
  key: string;
  message: string;
};

/**
 * A thread's sandbox. Not `pi-<thread>`: those belong to threads on the board before its store moved, and new threads
 * reuse their IDs.
 */
export const piSandbox = (thread: string) => `board-${thread}`;

/** Puts fresh tokens in a running sandbox's network policy, and says when they die. */
async function giveTokens(sandbox: Sandbox, thread: string) {
  const [{ getToken }, { getVercelOidcToken }] = await Promise.all([import("@vercel/connect"), import("@vercel/oidc")]);
  const [gateway, board, github] = await Promise.all([
    getVercelOidcToken(),
    getVercelOidcToken({ audience: BOARD }),
    getToken(CONNECTOR, GITHUB_TOKEN),
  ]);
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  await sandbox.update({ networkPolicy: policy(thread, { gateway, board, github }, bypass) });
  // GitHub's lasts the session (GITHUB_TOKEN); the OIDC ones, only as long as this function's.
  return {
    tokensEnd: Math.min(expiresAt(gateway), expiresAt(board)),
    sessionEnd: sandbox.expiresAt?.getTime() ?? Date.now() + SANDBOX_MS,
  };
}

/** Pi's OIDC tokens can die before its session does (`tokens.ts`), so these give it new ones first. */
export const piTokens = tokenRefreshes({
  store: tokensStore,
  scheduler: tokensQueue,
  give: async (thread) => {
    const { Sandbox } = await import("@vercel/sandbox");
    const sandbox = await Sandbox.get({ name: piSandbox(thread) });
    // A stopped sandbox gets new tokens with its next message.
    if (sandbox.status !== "running") return null;
    return giveTokens(sandbox, thread);
  },
});

async function deliver({ task, thread, key, message }: PiMessage) {
  const { Sandbox } = await import("@vercel/sandbox");
  const settings = {
    name: piSandbox(thread),
    runtime: "node24",
    timeout: SANDBOX_MS,
    persistent: true,
    snapshotExpiration: SNAPSHOT_MS,
    env: {
      AI_GATEWAY_API_KEY: "from-the-network-policy",
      BOARD_URL: BOARD,
      BOARD_TOKEN: "from-the-network-policy",
      GH_TOKEN: "from-the-network-policy",
    },
    ...GIT,
    // Pi's name rides along on each commit as its co-author.
    __commitAs: { name: piName(thread), email: GIT_EMAIL },
  } as const;
  let sandbox = await Sandbox.getOrCreate(settings);
  // Stopped with nothing to resume (its snapshot expired): the thread starts over in a new one.
  if (sandbox.status === "stopped" && !sandbox.currentSnapshotId) {
    await sandbox.delete();
    sandbox = await Sandbox.create(settings);
  }
  // Every turn, so a sandbox picks up a new pinned vb; before the policy, so no credential is in place yet.
  await sh(sandbox, SETUP);
  await sandbox.writeFiles(await piFiles());
  // A message landing late in a session (say, one started by an earlier turn) still gets a full SANDBOX_MS.
  const extend = extension(sandbox.expiresAt, Date.now());
  if (extend > 0) await sandbox.extendTimeout(extend);
  // Fresh tokens with every message, so a thread can pick up again days later, and again before they die if
  // that's before the session ends.
  await piTokens.later(thread, await giveTokens(sandbox, thread));
  await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", TELL],
    env: {
      MODEL,
      SESSION: piSession(thread),
      INSTRUCTIONS: `${INSTRUCTIONS[task]}\nOn the board you're ${piName(thread)}: the Pi for thread #${thread} only. Other threads have their own Pi, with names of their own.`,
      KEY: key,
      MESSAGE: message,
    },
    detached: true,
  });
}
