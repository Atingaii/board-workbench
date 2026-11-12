import type { Board, MessageView } from "@vercel/board";
import { NAME } from "../agent/lib/identity.ts";
import { githubScope, ownRepo } from "./github.ts";

// The launcher's steps: each checks what the factory needs, from this deployment, and says what to do
// about what isn't there. Nothing here writes anything.

/** One thing to do: a line, then each command in its own box, or a link. */
export type Fix = { text: string; commands?: string[]; link?: { href: string; label: string } };

/** One thing a step needs: there, or not, with what to do about it. */
export type Check = { label: string; done: boolean; fix?: Fix };

export type StepId = "vercel" | "github" | "slack" | "try";

/** What Vercel Connect needs to mint a GitHub token for some repos alone. */
type Scope = NonNullable<ReturnType<typeof githubScope>>;

/** A step is done once each of its checks is. An optional one never holds up the rest. */
export type Step = { id: StepId; title: string; optional?: boolean; checks: Check[] };

export const isDone = (step: Step) => step.checks.every((check) => check.done);

/** What the launcher shows: its steps, or while strangers can open this deployment, only how to protect it. */
export type Setup = { open: false; steps: Step[] } | { open: true; fix: Fix };

type Env = Record<string, string | undefined>;

/** What the board syncs, as its route configures it: the checks look for these. */
export type Synced = {
  connectors: { github: string; slack: string };
  repoChannels: Record<string, string>;
  slackChannels: Record<string, string>;
  /** The board's name, or null for the team's default board. */
  board: string | null;
};

/** What the checks reach: the environment, the network, and the board. Tests pass their own. */
export type Deps = {
  env: Env;
  synced: Synced;
  /** The host the checks were asked on: what strangers could reach. Production's when unknown. */
  host?: string | null;
  fetch: typeof fetch;
  /** This deployment's OIDC token. */
  oidc(): Promise<string>;
  /** A Connect connector's app token, or with `scope`, one for those GitHub repos alone. */
  connect(connector: string, scope?: Scope): Promise<string>;
  /** AI Gateway's balance, in dollars. */
  credits(): Promise<number>;
  /** What this deployment may do on its board, by channel pattern. Rejects with the board's own error when it can't use it. */
  access(): Promise<Record<string, readonly string[]>>;
  /** The board's latest messages in a channel, newest last. */
  messages(query: { channel: string; limit: number }): Promise<MessageView[]>;
};

const TITLES: Record<StepId, string> = { vercel: "Vercel", github: "GitHub", slack: "Slack", try: "Try it" };

const step = (id: StepId, checks: Check[], optional = false): Step => ({ id, title: TITLES[id], ...(optional ? { optional } : {}), checks });

const yes = (label: string): Check => ({ label, done: true });
const no = (label: string, fix?: Fix): Check => ({ label, done: false, ...(fix ? { fix } : {}) });

/** One command that creates a connector for this project and sends its webhooks to the board, from any directory. */
const createConnector = (service: "github" | "slack", connector: string, project: Project) =>
  `vercel connect create ${service} --name ${connector.split("/")[1] ?? "factory"} --triggers --trigger-project ${project?.name ?? "<project>"} --trigger-path /api/board/webhooks/${service}${project ? ` --scope ${project.team}` : ""}`;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 200);

type Project = { team: string; name: string } | null;

/** The project a token names: its team's slug and its own name, or null when it doesn't read as one. */
export function projectOf(jwt: string): Project {
  try {
    const { owner, project } = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString());
    return typeof owner === "string" && typeof project === "string" ? { team: owner, name: project } : null;
  } catch {
    return null;
  }
}

/** Where the project's settings are, from its OIDC token's claims. */
function dashboard(project: Project) {
  const base = project ? `https://vercel.com/${project.team}/${project.name}` : "https://vercel.com/dashboard";
  return { base, settings: (path: string) => (project ? `${base}/settings/${path}` : base), team: project ? `https://vercel.com/${project.team}` : base };
}

/**
 * Whether `host` turns strangers away, or why that couldn't be told: asked from outside, without
 * credentials. It asks for a static file, so an open deployment answers without rendering a page that
 * asks again.
 */
export async function closed(host: string | undefined, request: typeof fetch): Promise<boolean | Error> {
  if (!host) return new Error("no host to check");
  const status = await request(`https://${host}/icon.svg`, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) }).then(
    (response) => response.status,
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );
  if (status instanceof Error) return status;
  return status === 401 || status === 403 || (status >= 300 && status < 400);
}


const SIGN_IN: Fix = { text: "Link this directory and pull its environment, then restart the dev server.", commands: ["vercel link", "vercel env pull"] };

/** Your machine: `vercel env pull` writes VERCEL_ENV=development, so that counts too. */
export const isLocal = (env: Env) => !env.VERCEL_ENV || env.VERCEL_ENV === "development";

/** Where the repos and Slack channels the board syncs are named. */
const CHANNELS_FILE = "app/api/board/[[...path]]/channels.ts";

/** That file in this factory's own repo on GitHub, on the branch it was deployed from: undefined off a deployment from Git. */
function channelsFile(env: Env): { href: string; label: string } | undefined {
  const own = ownRepo(env);
  if (!own) return undefined;
  const path = CHANNELS_FILE.split("/").map(encodeURIComponent).join("/");
  return { href: `https://github.com/${own}/blob/${env.VERCEL_GIT_COMMIT_REF || "main"}/${path}`, label: "channels.ts" };
}

/** The command that opens the board in a browser, as whoever runs it: on `team`, when it's known, and by its name when it has one. */
export const inspectCommand = (team: string | undefined, board: string | null) =>
  `npx @vercel/board inspect${team ? ` --scope ${team}` : ""}${board ? ` --name ${board}` : ""}`;

/** The steps, in order. While strangers can open this deployment, or that can't be told, only how to protect it. */
export async function setup(deps: Deps): Promise<Setup> {
  const local = isLocal(deps.env);
  const token = await deps.oidc().catch(() => null);
  const project = token ? projectOf(token) : null;
  if (!local) {
    const shut = await closed(deps.host ?? deps.env.VERCEL_PROJECT_PRODUCTION_URL, deps.fetch);
    if (shut instanceof Error) return { open: true, fix: { text: `Couldn't check that this deployment is protected: ${message(shut)}` } };
    if (!shut) {
      return {
        open: true,
        fix: {
          text: "Anyone can open this deployment. Turn on Vercel Authentication for all deployments.",
          link: { href: dashboard(project).settings("deployment-protection"), label: "Deployment Protection" },
        },
      };
    }
  }
  const vercel = await vercelStep(deps, local, project);
  const [github, slack, tryIt] = await Promise.all([githubStep(deps, project), slackStep(deps, project), tryStep(deps, project, vercel.board)]);
  return { open: false, steps: [vercel.step, github, slack, tryIt] };
}

/** Protected, on the team's board, with AI Gateway. `board` says whether this project can use the board. */
async function vercelStep(deps: Deps, local: boolean, project: Project): Promise<{ step: Step; board: boolean }> {
  const links = dashboard(project);
  const signedOut = local && !deps.env.VERCEL_OIDC_TOKEN;
  const checks: Check[] = [];
  if (!local) {
    checks.push(yes("Deployment Protection is on."));
    if (!project) {
      checks.push(no("This deployment can't get an OIDC token.", { text: "Turn on OIDC Federation, then redeploy.", link: { href: links.settings("security"), label: "Security" } }));
      return { step: step("vercel", checks), board: false };
    }
  }

  // The board is the team's, in Vercel's API. A team has one once someone on it has opened it.
  const access = await deps.access().catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  const board = !(access instanceof Error);
  if (access instanceof Error) {
    const refused = ["board_not_granted", "no_board"].includes((access as { code?: string }).code ?? "");
    checks.push(
      no(
        "This project can't use the team's board yet.",
        signedOut
          ? SIGN_IN
          : refused
            ? {
                text: "A team's board exists once someone on the team has opened it, so open it once. If it's there and its grants were narrowed, someone who manages it lets this project in.",
                commands: [inspectCommand(project?.team, deps.synced.board)],
              }
            : { text: `Couldn't reach the board: ${message(access)}` },
      ),
    );
  } else {
    checks.push(yes("This project can use the team's board."));
    // A board lets every project on its team sync unless someone narrowed its grants: then it's theirs to widen.
    const syncs = Object.values(access).some((can) => can.includes("sync"));
    checks.push(
      syncs
        ? yes("It can sync GitHub and Slack with the board.")
        : no("It can't sync GitHub and Slack with the board.", { text: "The board's grants were narrowed. Someone who manages the board can let this project sync." }),
    );
  }

  const balance = await deps.credits().catch((error: unknown) => error);
  // A prepaid team's balance runs down to zero; a team billed for usage shows it as negative.
  if (typeof balance === "number" && balance !== 0) checks.push(yes("AI Gateway has credits."));
  else if (balance === 0) checks.push(no("AI Gateway is out of credits.", { text: "Add AI Gateway credits.", link: { href: `${links.team}/~/ai`, label: "AI Gateway" } }));
  else checks.push(no("AI Gateway isn't reachable.", signedOut ? SIGN_IN : { text: `AI Gateway answered: ${message(balance)}` }));

  return { step: step("vercel", checks), board };
}

type Repo = { full_name: string };

const plural = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);

/** The connector, the repos its app is on, and among them this factory's own, which the agent changes to improve itself. */
async function githubStep(deps: Deps, project: Project): Promise<Step> {
  const connector = deps.synced.connectors.github;
  const own = ownRepo(deps.env);
  const token = await deps.connect(connector).catch((error: unknown) => error);
  if (typeof token !== "string") {
    const fix: Fix =
      isLocal(deps.env) && !deps.env.VERCEL_OIDC_TOKEN
        ? SIGN_IN
        : token instanceof Error && token.name === "ConnectorInstallationRequiredError"
          ? { text: `Install ${connector}'s app on your repos, this one included.` }
          : { text: "Create a GitHub connector for this project, and install its app on your repos, this one included.", commands: [createConnector("github", connector, project)] };
    return step("github", [no("There's no GitHub connector for this project yet.", fix)]);
  }
  const checks: Check[] = [yes("This project has a GitHub connector.")];

  const api = (path: string, init: RequestInit = {}) =>
    deps.fetch(`https://api.github.com${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", ...init.headers },
      signal: AbortSignal.timeout(10_000),
    });
  type Listed = { total_count: number; repositories: Repo[] };
  const read: [Listed, string | null] | Error = await Promise.all([
    api("/installation/repositories?per_page=100").then(async (response) => {
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      return (await response.json()) as Listed;
    }),
    api("/graphql", { method: "POST", body: JSON.stringify({ query: "query { viewer { login } }" }) })
      .then(async (response) => ((await response.json()) as { data?: { viewer?: { login?: string } } }).data?.viewer?.login ?? null)
      .catch(() => null),
  ]).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  if (read instanceof Error) return step("github", [...checks, no("The app's repos couldn't be listed.", { text: `Couldn't list the app's repos: ${message(read)}` })]);

  const [{ total_count, repositories }, viewer] = read;
  const app = viewer?.replace(/\[bot\]$/, "") ?? null;
  const install = app ? { href: `https://github.com/apps/${app}/installations/new`, label: "Configure the app" } : undefined;
  if (total_count === 0) {
    return step("github", [...checks, no("Its app isn't on any repo yet.", { text: "Install the app on your repos, this one included.", ...(install ? { link: install } : {}) })]);
  }
  // Installed but in no channel: the board drops their PRs and issues (matched as GitHub writes them).
  const mapped = deps.synced.repoChannels;
  const off = total_count > repositories.length ? [] : repositories.map((repo) => repo.full_name).filter((name) => !(name in mapped));
  const unmapped = off.length
    ? ` ${off.slice(0, 2).join(", ")}${off.length > 2 ? `, +${off.length - 2}` : ""} ${off.length === 1 ? "isn't" : "aren't"} in repoChannels, so ${off.length === 1 ? "its" : "their"} PRs and issues stay off the board.`
    : "";
  checks.push(yes(`Its app is on ${plural(total_count, "repo")}.${unmapped}`));
  if (!own) return step("github", checks);

  const repo = repositories.find((candidate) => candidate.full_name.toLowerCase() === own.toLowerCase());
  if (!repo && total_count > repositories.length) {
    return step("github", [...checks, no(`Couldn't find ${own} among the app's repos.`, { text: `The app has over ${repositories.length} repos, more than this page lists. Check that ${own} is one of them.`, ...(install ? { link: install } : {}) })]);
  }
  if (!repo) {
    return step("github", [...checks, no(`The app isn't on ${own}.`, { text: `Install the app on ${own} too, so the agent can change its own code.`, ...(install ? { link: install } : {}) })]);
  }
  // GitHub lists an app's repos with every permission false, so ask for what the agent's turns ask
  // for (agent/lib/credentials.ts): a token for this repo alone, here one that can write to it, which
  // GitHub only issues when the app may.
  const writable = await deps.connect(connector, githubScope([repo.full_name], ["contents:write"])!).catch((error: unknown) => error);
  if (typeof writable !== "string") {
    return step("github", [...checks, no(`The app can't write to ${own}.`, { text: `Give the app write access to ${own}, so the agent can change its own code.`, ...(install ? { link: install } : {}) })]);
  }
  return step("github", [...checks, yes(`It can write to ${own}, so the agent can change its own code.`)]);
}

async function slackStep(deps: Deps, project: Project): Promise<Step> {
  const connector = deps.synced.connectors.slack;
  const wanted = Object.keys(deps.synced.slackChannels);
  const channel = wanted.join(", ");
  const source = channelsFile(deps.env);
  // What the channel is for, and where to name another: the same line whether or not the app's handle is known yet.
  const invite = (channels: string, command?: string): Fix => ({
    text: `Invite the app to ${channels}, a public channel. It's where the factory updates itself: its own pull requests land there, and it's where to talk about how it works. To use another channel, name it in slackChannels, in channels.ts.`,
    ...(command ? { commands: [command] } : {}),
    ...(source ? { link: source } : {}),
  });
  const token = await deps.connect(connector).catch((error: unknown) => error);
  if (typeof token !== "string") {
    // The board already syncs through this connector, and picks it up within a minute of its attach: no redeploy.
    const fix: Fix = isLocal(deps.env) && !deps.env.VERCEL_OIDC_TOKEN ? SIGN_IN : { text: "Create a Slack connector for this project.", commands: [createConnector("slack", connector, project)] };
    return step("slack", [no("There's no Slack connector for this project yet.", fix), no(`Its app isn't in ${channel} yet.`, invite(channel))], true);
  }
  const slack = async <T>(method: string, query = "") => {
    const response = await deps.fetch(`https://slack.com/api/${method}${query}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const data = (await response.json()) as T & { ok: boolean; error?: string };
    if (!data.ok) throw new Error(`Slack's ${method}: ${data.error ?? response.status}`);
    return data;
  };
  type Checked = [{ team: string; user: string }, { channels: { id: string; name: string }[] }];
  const checked: Checked | Error = await Promise.all([
    slack<Checked[0]>("auth.test"),
    // Public channels only: Connect's Slack app can read those (channels:read), not private ones (groups:read).
    slack<Checked[1]>("users.conversations", "?types=public_channel&exclude_archived=true&limit=200"),
  ]).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  if (checked instanceof Error) return step("slack", [yes("This project has a Slack connector."), no("Slack couldn't be asked about it.", { text: message(checked) })], true);
  const [who, mine] = checked;
  const missing = wanted.filter((name) => !mine.channels.some((candidate) => candidate.id === name || candidate.name === name.replace(/^#/, "")));
  const connected = yes(`This project has a Slack connector, in ${who.team} as @${who.user}.`);
  if (missing.length) {
    return step("slack", [connected, no(`Its app isn't in ${missing.join(", ")} yet.`, invite(missing.join(", "), `/invite @${who.user}`))], true);
  }
  return step("slack", [connected, yes(`Its app is in ${channel}, which mirrors the board.`)], true);
}

async function tryStep(deps: Deps, project: Project, board: boolean): Promise<Step> {
  const open: Fix = { text: "Open an issue on one of its repos, or post on the board. This opens it:", commands: [inspectCommand(project?.team, deps.synced.board)] };
  const waiting = (fix: Fix) => step("try", [no("Nobody has posted yet.", fix), no("The agent hasn't replied yet.")]);
  if (!board) return waiting({ text: "The board comes first: see Vercel, above." });
  const read: MessageView[][] | Error = await Promise.all([
    deps.messages({ channel: "dev", limit: 200 }),
    deps.messages({ channel: "dev/factory", limit: 200 }),
  ]).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  if (read instanceof Error) return waiting({ text: `Couldn't read the board: ${message(read)}` });
  const recent = read.flat();
  const heard = recent.some((m) => m.by.profile !== NAME);
  const replied = recent.some((m) => m.by.profile === NAME);
  return step("try", [heard ? yes("Someone has posted.") : no("Nobody has posted yet.", open), replied ? yes("The agent has replied.") : no("The agent hasn't replied yet.", heard ? { text: "Give it a minute, then check again." } : undefined)]);
}

/** What the checks ask the board, as this deployment. */
export const boardDeps = (board: Board): { access: Deps["access"]; messages: Deps["messages"] } => ({
  access: async () => (await board.me()).can,
  messages: async (query) => (await board.messages(query)).messages,
});

/** The checks' real dependencies, loaded only when the launcher runs. */
export async function liveDeps(board: { access: Deps["access"]; messages: Deps["messages"] }, synced: Synced): Promise<Deps> {
  const [{ getVercelOidcToken }, { getToken }, { gateway }] = await Promise.all([
    import("@vercel/oidc"),
    import("@vercel/connect"),
    import("ai"),
  ]);
  return {
    env: process.env,
    synced,
    fetch,
    oidc: () => getVercelOidcToken(),
    connect: (connector, scope) => getToken(connector, { subject: { type: "app" }, ...(scope ? { authorizationDetails: scope } : {}) }),
    credits: async () => Number((await gateway.getCredits()).balance),
    access: board.access,
    messages: board.messages,
  };
}
