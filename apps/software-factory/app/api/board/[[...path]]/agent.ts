import type { NetworkPolicy, Sandbox } from "@vercel/sandbox";

// Pi, the coding agent, working on a board thread from its own Vercel Sandbox: the
// `pi` CLI with `vb`, `gh`, and git, like a developer at a terminal. Credentials are
// placeholders inside the sandbox; its network policy puts the real ones on the wire,
// so nothing in the sandbox can read them.

/** The board the agent's `vb` talks to. A sandbox can only reach a public one: production. */
const BOARD = "https://vboard-basehub.vercel.app/api/board";
const MODEL = "anthropic/claude-sonnet-5";
/** A run gets this long, then the sandbox stops on its own. */
const SANDBOX_MS = 45 * 60_000;

const INSTRUCTIONS = `You work on vboard (github.com/basehub-ai/vboard, private), a message board library and CLI.
The board is how you talk to people: vb read <id> shows a thread, vb reply <id> "<text>" answers in it (and reaches Slack or GitHub when the thread is synced), vb label <id> k=v labels it. Run vb help for the rest.
gh and git are signed in to GitHub as factory-basehub[bot], read-only: clone with gh repo clone basehub-ai/vboard. Don't push, and don't comment on GitHub; report on the board.
The repo uses pnpm (pnpm install, pnpm test). Reply in the thread when you're done, even if you didn't get far.`;

const SETUP = `set -e
npm install -g @earendil-works/pi-coding-agent vboard pnpm >/dev/null 2>&1
command -v gh >/dev/null || {
  v=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | sed -n 's/.*"tag_name": *"v\\([^"]*\\)".*/\\1/p')
  curl -fsSL "https://github.com/cli/cli/releases/download/v$v/gh_\${v}_linux_amd64.tar.gz" | tar xz -C /tmp
  install "/tmp/gh_\${v}_linux_amd64/bin/gh" /usr/local/bin/gh
}`;

/** Starts Pi once per sandbox, even if the watcher that asked is retried. */
const START = `[ -e ~/.pi-started ] && exit 0
touch ~/.pi-started
cd ~ && exec pi -p --provider vercel-ai-gateway --model "$MODEL" --session-id "$SESSION" --append-system-prompt "$INSTRUCTIONS" "$TASK" > ~/pi.log 2>&1`;

const deny = (why: string) =>
  ({ response: { statusCode: 403, contentType: "text/plain", body: `${why}\n` } }) as const;

/** Real credentials on the way out, and GitHub read-only: no pushes, no REST writes. */
function policy(tokens: { gateway: string; board: string; github: string }): NetworkPolicy {
  const github = [{ transform: [{ headers: { authorization: `Bearer ${tokens.github}` } }] }];
  const basic = Buffer.from(`x-access-token:${tokens.github}`).toString("base64");
  return {
    allow: {
      // Pi speaks the Anthropic messages API to AI Gateway, which reads x-api-key.
      "ai-gateway.vercel.sh": [
        { transform: [{ headers: { "x-api-key": tokens.gateway, authorization: `Bearer ${tokens.gateway}` } }] },
      ],
      [new URL(BOARD).host]: [{ transform: [{ headers: { authorization: `Bearer ${tokens.board}` } }] }],
      "github.com": [
        { match: { path: { regex: "/git-receive-pack$" } }, ...deny("this sandbox can't push") },
        {
          match: { queryString: [{ key: { exact: "service" }, value: { exact: "git-receive-pack" } }] },
          ...deny("this sandbox can't push"),
        },
        { transform: [{ headers: { authorization: `Basic ${basic}` } }] },
      ],
      // gh reads through GraphQL, which is always a POST; the REST API stays read-only.
      "api.github.com": [
        { match: { method: ["POST"], path: { exact: "/graphql" } }, ...github[0] },
        { match: { method: ["POST", "PUT", "PATCH", "DELETE"] }, ...deny("this sandbox is read-only on GitHub") },
        ...github,
      ],
      "*": [],
    },
  };
}

async function sh(sandbox: Sandbox, script: string, env: Record<string, string> = {}) {
  const done = await sandbox.runCommand({ cmd: "bash", args: ["-c", script], env, sudo: true });
  if (done.exitCode !== 0) throw new Error(`sandbox setup failed: ${(await done.stderr()).slice(-500)}`);
}

/** Puts Pi to work on a thread. Safe to call again for the same thread: it starts once. */
export async function startPi({ thread, task }: { thread: number; task: string }) {
  const [{ Sandbox }, { getToken }, { getVercelOidcToken }] = await Promise.all([
    import("@vercel/sandbox"),
    import("@vercel/connect"),
    import("@vercel/oidc"),
  ]);
  const sandbox = await Sandbox.getOrCreate({
    name: `pi-${thread}`,
    runtime: "node24",
    timeout: SANDBOX_MS,
    persistent: false,
    env: {
      AI_GATEWAY_API_KEY: "from-the-network-policy",
      VBOARD_URL: BOARD,
      VBOARD_TOKEN: "from-the-network-policy",
      GH_TOKEN: "from-the-network-policy",
    },
  });
  // Tools first, while the sandbox can still reach anything and holds no credentials.
  await sh(sandbox, SETUP);
  const [gateway, board, github] = await Promise.all([
    getVercelOidcToken(),
    getVercelOidcToken({ audience: BOARD }),
    getToken("github/factory", { subject: { type: "app" } }),
  ]);
  await sandbox.update({ networkPolicy: policy({ gateway, board, github }) });
  await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", START],
    env: { MODEL, SESSION: `thread-${thread}`, INSTRUCTIONS, TASK: task },
    detached: true,
  });
}
