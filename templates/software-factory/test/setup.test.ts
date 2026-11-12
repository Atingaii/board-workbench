import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { agentPrompt, markdown } from "../lib/markdown.ts";
import { channel } from "../lib/project.ts";
import { isDone, setup, type Deps, type Step, type Task } from "../lib/setup.ts";

// The launcher's steps, driven as the page drives them, against a fake network: what a person sees is
// each step's tasks, done or with what helps do them, and what the outside world sees is the requests it sends.

const jwt = (claims: object) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A production deployment of acme/factory with everything it needs. */
const PRODUCTION = {
  VERCEL_ENV: "production",
  VERCEL_PROJECT_PRODUCTION_URL: "factory.acme.dev",
  VERCEL_GIT_REPO_OWNER: "acme",
  VERCEL_GIT_REPO_SLUG: "factory",
};

type Routes = Record<string, (init?: RequestInit, url?: string) => Response>;

const ROUTES: Routes = {
  "https://factory.acme.dev/icon.svg": () => new Response("", { status: 401 }),
  "https://api.github.com/installation/repositories": () =>
    json({ total_count: 2, repositories: [{ full_name: "acme/factory" }, { full_name: "acme/web" }] }),
  "https://api.github.com/graphql": () => json({ data: { viewer: { login: "acme-factory" } } }),
};

/** What Connect throws for a connector that doesn't exist. */
const notFound = (connector: string) =>
  Promise.reject(Object.assign(new Error(`Connector not found: ${connector}`), { name: "ConnectError", status: 404, code: "not_found" }));


/** This deployment on its board: who the agent writes as, with no profile. */
const DEPLOYMENT = "vercel:project:prj_factory:production";
const me = (can: Record<string, string[]>) => ({ principal: DEPLOYMENT, can });

/** A message by a person, or by the agent. */
const message = (id: string, from: "ada" | "agent", re: string | null = null) =>
  ({ id, re, by: { principal: from === "agent" ? DEPLOYMENT : "vercel:user:u_ada", profile: null, actor: "a" }, createdAt: "2026-11-03T00:00:00.000Z" }) as never;

function fake(options: { env?: Record<string, string | undefined>; routes?: Routes; deps?: Partial<Deps> } = {}) {
  const requests: string[] = [];
  const routes = { ...ROUTES, ...options.routes };
  const deps: Deps = {
    env: options.env ?? PRODUCTION,
    // As the board route configures it, on a deployment of acme/factory.
    synced: {
      connectors: { github: "github/factory", slack: "slack/factory" },
      repoChannels: { "acme/factory": "project-factory/rsi" },
      slackChannels: { "#factory-rsi": "project-factory/rsi" },
      board: null,
      home: "project-factory",
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      requests.push(url);
      const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
      if (!route) throw new Error(`no route for ${url}`);
      return route[1](init, url);
    }) as typeof fetch,
    oidc: async () => jwt({ owner: "acme", project: "factory" }),
    // Every connector but Slack's, which a test connects when it needs one.
    connect: async (connector) => (connector.startsWith("slack/") ? notFound(connector) : "app-token"),
    credits: async () => 5,
    // What a new board gives every project on the team.
    me: async () => me({ "*": ["read", "post", "react", "label", "sync"] }),
    messages: async () => [message("12", "ada"), message("13", "agent", "12")],
    source: sources(() => CHANNELS),
    ...options.deps,
  };
  return { deps, requests };
}

/** The steps a protected deployment shows. */
async function shown(deps: Deps): Promise<Record<string, Step>> {
  const result = await setup(deps);
  assert.equal(result.open, false, "the launcher should show its steps");
  return Object.fromEntries((result.open ? [] : result.steps).map((step) => [step.id, step]));
}
/** What an open deployment shows instead: the one thing to do. */
async function onlyProtect(deps: Deps): Promise<Task> {
  const result = await setup(deps);
  assert.equal(result.open, true, "the launcher should show only how to protect the deployment");
  return (result as { task: Task }).task;
}
const done = (steps: Record<string, Step>) => Object.fromEntries(Object.entries(steps).map(([id, step]) => [id, isDone(step)]));
const todo = (step: Step) => step.tasks.filter((task) => !task.done);
const labels = (tasks: Task[]) => tasks.map((task) => task.label);
const commands = (step: Step) => todo(step).flatMap((task) => task.commands ?? []);
const links = (step: Step) => todo(step).flatMap((task) => (task.link ? [task.link.href] : []));

/** The files the launcher links to, as this checkout has them: what a fresh factory deploys. */
const CHANNELS = readFileSync(new URL("../app/api/board/[[...path]]/channels.ts", import.meta.url), "utf8");
const FACTORY = readFileSync(new URL("../app/api/board/[[...path]]/factory.ts", import.meta.url), "utf8");
const REPO_URL = "https://github.com/acme/factory/blob/main/app/api/board/%5B%5B...path%5D%5D";
const CHANNELS_URL = `${REPO_URL}/channels.ts`;
/** What the launcher reads when it's given another channels.ts. */
const sources = (channels: () => string | undefined): Deps["source"] => (file) => (file.endsWith("/channels.ts") ? channels() : file.endsWith("/factory.ts") ? FACTORY : undefined);

/** The line of `source` a link opens on, in `url`'s file in the factory's repo: what the person lands on. */
function linked(href: string, source = CHANNELS, url = CHANNELS_URL): string {
  const [, line] = /^(?:.+)#L(\d+)$/.exec(href) ?? [];
  assert.ok(href.startsWith(`${url}#L`) && line, `${href} should name a line of ${url}`);
  return source.split("\n")[Number(line) - 1] ?? "";
}

test("a factory that's set up passes every step but Slack, which stays optional", async () => {
  const steps = await shown(fake().deps);
  assert.deepEqual(done(steps), { vercel: true, github: true, slack: false, try: true });
  assert.equal(steps.slack!.optional, true);
});

test("it asks for no secret to get through its own protection, and shows no balance", async () => {
  const { vercel } = await shown(fake({ deps: { credits: async () => 16.44 } }).deps);
  assert.deepEqual(vercel!.tasks, [
    { label: "Turn on Deployment Protection", done: true },
    { label: "Open the team's board once", done: true },
    { label: "Add AI Gateway credits", done: true },
  ]);
});

test("GitHub names the repos the app is on that come into no channel, and links to where one is added", async () => {
  // The app is on acme/factory, which comes into its channel on its own, and acme/web, which no one mapped.
  const { github } = await shown(fake().deps);
  assert.equal(isDone(github!), true);
  const installed = github!.tasks.find((task) => task.hint);
  assert.equal(installed?.hint, "acme/web isn't on the board yet.");
  // The link opens where the map of repos starts.
  assert.match(linked(installed!.link!.href), /^export const repoChannels\b/);
});

test("GitHub asks Connect for a token that writes to the factory's own repo alone, as the agent's turns do", async () => {
  const asked: unknown[] = [];
  const { github } = await shown(fake({ deps: { connect: async (connector, scope) => (asked.push(scope ?? null), connector.startsWith("slack/") ? notFound(connector) : "app-token") } }).deps);
  assert.equal(isDone(github!), true);
  assert.deepEqual(asked.filter(Boolean), [[{ type: "github_app_installation", org: "acme", repositories: ["factory"], permissions: ["contents:write"] }]]);
});

test("GitHub isn't done until the app can write to the factory's own repo", async () => {
  // GitHub refuses a token with contents:write for an app that can't write there.
  const { github } = await shown(
    fake({ deps: { connect: async (connector, scope) => (scope ? Promise.reject(new Error("GitHub installation token failed")) : connector.startsWith("slack/") ? notFound(connector) : "app-token") } }).deps,
  );
  assert.deepEqual(todo(github!).map((task) => [task.label, task.hint]), [["Let the app write to `acme/factory`", "So the agent can change its own code."]]);
  assert.deepEqual(links(github!), ["https://github.com/apps/acme-factory/installations/new"]);
});

test("GitHub says nothing more when every repo the app is on comes in", async () => {
  const { github } = await shown(
    fake({ routes: { "https://api.github.com/installation/repositories": () => json({ total_count: 1, repositories: [{ full_name: "acme/factory" }] }) } }).deps,
  );
  assert.deepEqual(github!.tasks.filter((task) => task.hint || task.link), []);
});

test("an open production shows only how to protect it, and asks nothing of GitHub or the board", async () => {
  let read = false;
  const { deps, requests } = fake({
    routes: { "https://factory.acme.dev/icon.svg": () => new Response("<svg/>", { status: 200 }) },
    deps: { messages: async () => ((read = true), []), me: async () => ((read = true), me({})) },
  });
  const task = await onlyProtect(deps);
  assert.equal(task.link?.href, "https://vercel.com/acme/factory/settings/deployment-protection");
  assert.deepEqual(requests, ["https://factory.acme.dev/icon.svg"]);
  assert.equal(read, false);
});

test("an open preview shows only how to protect it, even while production is closed", async () => {
  const { deps, requests } = fake({
    deps: { host: "factory-git-fix-acme.vercel.app" },
    routes: { "https://factory-git-fix-acme.vercel.app/icon.svg": () => new Response("<svg/>", { status: 200 }) },
  });
  await onlyProtect(deps);
  assert.deepEqual(requests, ["https://factory-git-fix-acme.vercel.app/icon.svg"]);
});

test("a protection check that fails shows nothing else, as if the deployment were open", async () => {
  const { deps, requests } = fake({ deps: { host: "unreachable.acme.dev" } });
  const task = await onlyProtect(deps);
  assert.match(task.label, /Couldn't check that this deployment is protected/);
  assert.match(task.hint ?? "", /no route for https:\/\/unreachable\.acme\.dev/);
  assert.deepEqual(requests, ["https://unreachable.acme.dev/icon.svg"]);
});

test("a team whose board nobody has opened yet is told to open it once, with the command that does", async () => {
  // What board() throws for a project the API names no board to: a team has one once a person has used it.
  const refused = Object.assign(new Error("this project has no access to the team's board (prj_factory, production)."), { code: "board_not_granted" });
  const { vercel, try: tryIt } = await shown(fake({ deps: { me: () => Promise.reject(refused) } }).deps);
  assert.deepEqual(labels(todo(vercel!)), ["Open the team's board once"]);
  assert.deepEqual(commands(vercel!), ["npx @vercel/board inspect --scope acme"]);
  // Try it waits on the board: its tasks are still to do, with nothing of the board's error under them.
  assert.deepEqual(tryIt!.tasks, [
    { label: "Post on the board, or open an issue", done: false },
    { label: "Get a reply from the agent", done: false },
  ]);
});

test("a board that can't be reached for another reason says what it answered", async () => {
  const { vercel } = await shown(fake({ deps: { me: () => Promise.reject(new Error("Vercel's API answered 503")) } }).deps);
  assert.equal(todo(vercel!)[0]?.hint, "Vercel's API answered 503");
  assert.deepEqual(commands(vercel!), []);
});

test("a project the board's grants don't let sync isn't ready, and is told who can let it, with no grant of the launcher's own", async () => {
  const { vercel } = await shown(fake({ deps: { me: async () => me({ "*": ["read", "post", "react", "label"] }) } }).deps);
  assert.deepEqual(todo(vercel!).map((task) => [task.label, task.hint]), [
    ["Let this project sync on the board", "Its grants were narrowed. Whoever manages the board can widen them."],
  ]);
  assert.deepEqual(commands(vercel!), []);
});

test("sync in one channel pattern is enough for the Vercel step", async () => {
  const { vercel } = await shown(fake({ deps: { me: async () => me({ "*": ["read"], "dev/": ["read", "post", "sync"] }) } }).deps);
  assert.equal(isDone(vercel!), true);
});

test("a GitHub connector that isn't attached says how to create and attach it, a command per box", async () => {
  const { github } = await shown(fake({ deps: { connect: async () => Promise.reject(new Error("connector not found")) } }).deps);
  assert.equal(isDone(github!), false);
  assert.deepEqual(commands(github!), [
    "vercel connect create github --name factory --triggers --trigger-project factory --trigger-path /api/board/webhooks/github --scope acme",
  ]);
});

/** What Connect throws this project for a connector that's on its team for another project. */
const notLinked = () => Promise.reject(Object.assign(new Error("Connector is not linked to this project"), { name: "ConnectError", status: 403, code: "forbidden" }));

test("a connector another project on the team has is attached, not created again, with where to name another", async () => {
  // A team has one connector per name: creating github/factory again answers 409.
  const { github, slack } = await shown(fake({ deps: { connect: notLinked } }).deps);
  assert.deepEqual(labels(todo(github!)), ["Attach `github/factory` to this project", "Install its app on your repos"]);
  assert.deepEqual(commands(github!), ["vercel connect attach github/factory --triggers --trigger-path /api/board/webhooks/github --project factory --scope acme"]);
  assert.equal(todo(github!)[0]!.hint, "It's on this team for another project.");
  // The link opens where this factory's connectors are named.
  assert.match(linked(links(github!)[0]!, FACTORY, `${REPO_URL}/factory.ts`), /^export const connectors\b/);
  assert.deepEqual(labels(todo(slack!)), ["Attach `slack/factory` to this project", "Invite the app to `#factory-rsi`"]);
  assert.deepEqual(commands(slack!), ["vercel connect attach slack/factory --triggers --trigger-path /api/board/webhooks/slack --project factory --scope acme"]);
});

test("GitHub isn't done until the app is on the factory's own repo", async () => {
  const { github } = await shown(
    fake({
      routes: { "https://api.github.com/installation/repositories": () => json({ total_count: 1, repositories: [{ full_name: "acme/web" }] }) },
    }).deps,
  );
  assert.deepEqual(labels(todo(github!)), ["Install the app on `acme/factory`"]);
  assert.deepEqual(links(github!), ["https://github.com/apps/acme-factory/installations/new"]);
});

test("an app GitHub lists with every permission false is done once it can write", async () => {
  // How GitHub answers /installation/repositories for an app's token, whatever the app may do.
  const { github } = await shown(
    fake({
      routes: {
        "https://api.github.com/installation/repositories": () =>
          json({ total_count: 1, repositories: [{ full_name: "acme/factory", permissions: { admin: false, push: false, pull: false } }] }),
      },
    }).deps,
  );
  assert.equal(isDone(github!), true);
});

test("Slack without its connector shows how to create it, then to invite its app", async () => {
  const { slack } = await shown(fake().deps);
  assert.deepEqual(labels(todo(slack!)), ["Create a Slack connector", "Invite the app to `#factory-rsi`"]);
  assert.deepEqual(commands(slack!), [
    "vercel connect create slack --name factory --triggers --trigger-project factory --trigger-path /api/board/webhooks/slack --scope acme",
  ]);
});

/** Slack's users.conversations as Connect's Slack app gets it: channels:read, but not groups:read. */
const conversations = (...channels: { id: string; name: string }[]) => (_init?: RequestInit, url = "") =>
  url.includes("private_channel") ? json({ ok: false, error: "missing_scope", needed: "groups:read" }) : json({ ok: true, channels });

test("Slack set up without its app in the channel says to invite it, and holds up nothing", async () => {
  const { deps, requests } = fake({
    deps: { connect: async () => "app-token" },
    routes: {
      "https://slack.com/api/auth.test": () => json({ ok: true, team: "Acme", user: "factory" }),
      "https://slack.com/api/users.conversations": conversations({ id: "C1", name: "general" }),
    },
  });
  const steps = await shown(deps);
  assert.deepEqual(labels(todo(steps.slack!)), ["Invite the app to `#factory-rsi`"]);
  assert.deepEqual(commands(steps.slack!), ["/invite @factory"]);
  // It says what the channel is for, in a line, and links to the line that names it, in this factory's own repo.
  assert.equal(todo(steps.slack!)[0]!.hint, "Where the factory updates itself.");
  // The template puts the channel's name together from the project's: that entry is the line.
  const [href] = links(steps.slack!);
  assert.match(linked(href!), /^\s*\[slackChannel\("-rsi"\)\]: channel\("rsi"\),$/);
  assert.ok(requests.includes("https://slack.com/api/auth.test"));
  assert.deepEqual(Object.values(steps).filter((step) => !step.optional && !isDone(step)), []);
});

/** Slack connected, its app in no channel yet: the step that links to the channel's line. */
const uninvited = (channels: () => string | undefined) =>
  fake({
    deps: { connect: async () => "app-token", source: sources(channels) },
    routes: {
      "https://slack.com/api/auth.test": () => json({ ok: true, team: "Acme", user: "factory" }),
      "https://slack.com/api/users.conversations": conversations(),
    },
  }).deps;

test("the link to the Slack channel follows its line after someone edits channels.ts", async () => {
  // A factory that added repos above its Slack channels, put another channel first, and wrote its own
  // in single quotes under a comment that names it.
  const edited = CHANNELS.replace('  // "acme/web": channel("web"),', '  "acme/web": channel("web"),\n  "acme/api": channel("api"),\n  "acme/docs": channel("docs"),').replace(
    '  [slackChannel("-rsi")]: channel("rsi"),',
    `  "#web": channel("web"),\n  // '#factory-rsi' is where the factory updates itself.\n  '#factory-rsi': channel("rsi"),`,
  );
  assert.equal(edited.split("\n").length, CHANNELS.split("\n").length + 4);
  const [href] = links((await shown(uninvited(() => edited))).slack!);
  assert.match(linked(href!, edited), /^\s*'#factory-rsi': channel\("rsi"\)/);
  // And not on the line it had before the edit.
  assert.notEqual(href, links((await shown(uninvited(() => CHANNELS))).slack!)[0]);
});

test("a channels.ts that can't be read, or doesn't name the channel on a line, is linked as a file", async () => {
  assert.deepEqual(links((await shown(uninvited(() => undefined))).slack!), [CHANNELS_URL]);
  assert.deepEqual(links((await shown(uninvited(() => "export const slackChannels = channelsFromEnv();\n"))).slack!), [CHANNELS_URL]);
  // A map with no entry has no line of its own: not its comment, not its closing brace.
  assert.deepEqual(links((await shown(uninvited(() => "export const slackChannels = {\n  // none yet\n};\n"))).slack!), [CHANNELS_URL]);
});

/** The board's config as a deployment with `env` loads it: its connectors, the Slack channels it mirrors, and the board channels they and its own repo come into. */
function configured(env: Record<string, string>): { connectors: Record<string, string>; slack: string[]; board: string[]; hears: string } {
  const script = `
    const { connectors, hears } = await import("./app/api/board/[[...path]]/factory.ts");
    const { repoChannels, slackChannels } = await import("./app/api/board/[[...path]]/channels.ts");
    console.log(JSON.stringify({ connectors, slack: Object.keys(slackChannels), board: [...new Set([...Object.values(repoChannels), ...Object.values(slackChannels)])], hears }));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: new URL("..", import.meta.url), env: { PATH: process.env.PATH, NODE_ENV: "test", ...env }, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").at(-1)!);
}

test("a factory's connectors, Slack channel and board channels are named for its Vercel project, so two on a team don't collide", () => {
  // Its own repo, on a deployment from Git, and its Slack channel both come into the channel where it changes itself.
  const git = { VERCEL_GIT_REPO_OWNER: "acme", VERCEL_GIT_REPO_SLUG: "factory" };
  assert.deepEqual(configured({ VERCEL_PROJECT_NAME: "acme-factory", ...git }), {
    connectors: { github: "github/acme-factory", slack: "slack/acme-factory" },
    slack: ["#acme-factory-rsi"],
    board: ["project-acme-factory/rsi"],
    // The agent hears its own channels and no other factory's.
    hears: "project-acme-factory/",
  });
  // A dev server has no VERCEL_PROJECT_NAME: its project is the one the token it pulled names.
  assert.deepEqual(configured({ VERCEL_OIDC_TOKEN: jwt({ owner: "acme", project: "web-factory" }) }), {
    connectors: { github: "github/web-factory", slack: "slack/web-factory" },
    slack: ["#web-factory-rsi"],
    board: ["project-web-factory/rsi"],
    hears: "project-web-factory/",
  });
  // Vercel takes a dot in a project's name and 100 characters. Slack takes neither in a channel's: 80 at most.
  assert.deepEqual(configured({ VERCEL_PROJECT_NAME: "acme.factory" }).slack, ["#acme-factory-rsi"]);
  const [long] = configured({ VERCEL_PROJECT_NAME: "f".repeat(100) }).slack;
  assert.equal(long, `#${"f".repeat(76)}-rsi`);
  // Signed out, with nothing to name it for.
  assert.deepEqual(configured({}), { connectors: { github: "github/factory", slack: "slack/factory" }, slack: ["#factory-rsi"], board: ["project-factory/rsi"], hears: "project-factory/" });
  // A board's channel takes no dot either, and 80 characters with what's under it.
  assert.equal(channel(undefined, { VERCEL_PROJECT_NAME: "acme.factory" }), "project-acme-factory");
  assert.equal(channel("web", { VERCEL_PROJECT_NAME: "acme.factory" }), "project-acme-factory/web");
  assert.equal(channel("web", { VERCEL_PROJECT_NAME: "f".repeat(100) }), `project-${"f".repeat(40)}/web`);
});

test("Slack's app in its channel, by name, is done", async () => {
  const { slack } = await shown(
    fake({
      deps: { connect: async () => "app-token" },
      routes: {
        "https://slack.com/api/auth.test": () => json({ ok: true, team: "Acme", user: "factory" }),
        "https://slack.com/api/users.conversations": conversations({ id: "C2", name: "factory-rsi" }),
      },
    }).deps,
  );
  assert.equal(isDone(slack!), true);
});

/** A reply by this deployment under a profile. */
const under = (profile: string) => ({ id: "13", re: "12", by: { principal: DEPLOYMENT, profile, actor: "a" } }) as never;

test("what the deployment's watcher wrote, or its sync brought in, isn't the agent's reply", async () => {
  const steps = await shown(fake({ deps: { messages: async () => [message("12", "ada"), under("wake"), under("github:user:583231")] } }).deps);
  assert.deepEqual(labels(todo(steps.try!)), ["Get a reply from the agent"]);
});

test("a reply from when the agent wrote under a profile of its own still counts", async () => {
  // A factory set up before its agent wrote as the factory itself: its replies are under `factory`.
  const steps = await shown(fake({ deps: { messages: async () => [message("12", "ada"), under("factory")] } }).deps);
  assert.equal(isDone(steps.try!), true);
});

test("try reads this factory's channels, and no one else's: its own and the ones under it, in one read", async () => {
  const asked: unknown[] = [];
  await shown(fake({ deps: { messages: async (query) => (asked.push(query), []) } }).deps);
  assert.deepEqual(asked, [{ channel: "project-factory/", limit: 200 }]);
});

test("try isn't done until someone has posted and the agent has replied", async () => {
  const nothing = await shown(fake({ deps: { messages: async () => [] } }).deps);
  assert.deepEqual(labels(todo(nothing.try!)), ["Post on the board, or open an issue", "Get a reply from the agent"]);
  const unanswered = await shown(fake({ deps: { messages: async () => [message("12", "ada")] } }).deps);
  assert.deepEqual(labels(todo(unanswered.try!)), ["Get a reply from the agent"]);
});

test("try says how to open the board in its own step, on this team and by the board's name, so the agent's tool has it too", async () => {
  const waiting = fake({ deps: { messages: async () => [] } });
  assert.deepEqual(commands((await shown(waiting.deps)).try!), ["npx @vercel/board inspect --scope acme"]);
  const named = fake({ deps: { messages: async () => [] } });
  named.deps.synced.board = "factory-dev";
  assert.deepEqual(commands((await shown(named.deps)).try!), ["npx @vercel/board inspect --scope acme --name factory-dev"]);
});

test("locally, nothing asks whether the deployment is protected, and signing in is one link and one pull, said once", async () => {
  const { deps, requests } = fake({
    env: { PORT: "3000" },
    deps: {
      oidc: async () => Promise.reject(new Error("no token")),
      credits: async () => Promise.reject(new Error("no token")),
      me: async () => Promise.reject(new Error("no team to find a board for")),
      connect: async () => Promise.reject(new Error("The 'x-vercel-oidc-token' header is missing")),
    },
  });
  const steps = await shown(deps);
  assert.deepEqual(done(steps), { vercel: false, github: false, slack: false, try: false });
  assert.deepEqual(Object.values(steps).flatMap(commands), ["vercel link", "vercel env pull"]);
  assert.ok(!requests.some((url) => url.includes("icon.svg")));
});

test("locally, a board that answers through your own login still leaves signing in to do, said once", async () => {
  // The directory is linked, so the board works as you, but its environment was never pulled.
  const { deps } = fake({
    env: { PORT: "3000" },
    deps: {
      oidc: async () => Promise.reject(new Error("no token")),
      credits: async () => Promise.reject(new Error("no token")),
      connect: async () => Promise.reject(new Error("The 'x-vercel-oidc-token' header is missing")),
    },
  });
  const steps = await shown(deps);
  assert.deepEqual(done(steps), { vercel: false, github: false, slack: false, try: true });
  assert.deepEqual(Object.values(steps).flatMap(commands), ["vercel link", "vercel env pull"]);
  assert.deepEqual(commands(steps.vercel!), ["vercel link", "vercel env pull"]);
});

test("AI Gateway without credits says where to add them", async () => {
  const { vercel } = await shown(fake({ deps: { credits: async () => 0 } }).deps);
  assert.deepEqual(labels(todo(vercel!)), ["Add AI Gateway credits"]);
  assert.deepEqual(links(vercel!), ["https://vercel.com/acme/~/ai"]);
});

test("a team billed for AI Gateway usage, with a negative balance, is ready", async () => {
  const { vercel } = await shown(fake({ deps: { credits: async () => -1194239.37 } }).deps);
  assert.equal(isDone(vercel!), true);
});

// The launcher for whatever doesn't ask for a page: the same steps, as markdown.

const INSPECT = "npx @vercel/board inspect --scope acme";

test("as markdown, the launcher is the page's steps as a checklist, each task with its help under it", async () => {
  // Everything set up but Slack's app in its channel. The links name no line: channels.ts wasn't read.
  const result = await setup(uninvited(() => undefined));
  assert.equal(
    markdown(result, INSPECT),
    `# Your software factory is running

Bring it issues, threads, and questions. 3 of 3 steps done, checked on this request.

## 1. Vercel (done)

- [x] Turn on Deployment Protection
- [x] Open the team's board once
- [x] Add AI Gateway credits

## 2. GitHub (done)

- [x] Create a GitHub connector
- [x] Install its app on your repos
  acme/web isn't on the board yet. [Add it](${CHANNELS_URL})
- [x] Let the app write to \`acme/factory\`

## 3. Slack (optional)

- [x] Create a Slack connector
- [ ] Invite the app to \`#factory-rsi\`
  Where the factory updates itself. [Change the channel](${CHANNELS_URL})

  \`\`\`
  /invite @factory
  \`\`\`

## 4. Try it (done)

- [x] Post on the board, or open an issue
- [x] Get a reply from the agent

## Watch the board

\`\`\`
${INSPECT}
\`\`\`
`,
  );
});

test("as markdown, a factory that isn't set up says so first, and gives each command its own block", async () => {
  const { deps } = fake({
    env: { PORT: "3000" },
    deps: {
      oidc: async () => Promise.reject(new Error("no token")),
      credits: async () => Promise.reject(new Error("no token")),
      me: async () => Promise.reject(new Error("no team to find a board for")),
      connect: async () => Promise.reject(new Error("The 'x-vercel-oidc-token' header is missing")),
    },
  });
  const text = markdown(await setup(deps), INSPECT);
  assert.ok(text.startsWith("# Set up your software factory\n\nAn agent that takes your team's issues to pull requests. 0 of 3 steps done, checked on this request.\n\n## 1. Vercel\n"));
  assert.ok(
    text.includes(`- [ ] Link this directory, then restart the dev server

  \`\`\`
  vercel link
  \`\`\`

  \`\`\`
  vercel env pull
  \`\`\`

- [ ] Open the team's board once
`),
    text,
  );
  // The board's command isn't in a task here, so it's under the steps.
  assert.ok(text.endsWith(`## Watch the board\n\n\`\`\`\n${INSPECT}\n\`\`\`\n`), text);
});

test("the command that opens the board is on the launcher once, always: in the task that asks for it, or under the steps", async () => {
  const count = (text: string) => text.split(INSPECT).length - 1;
  // Nobody has posted: the task that says to post carries it.
  const fresh = markdown(await setup(fake({ deps: { messages: async () => [] } }).deps), INSPECT);
  assert.equal(count(fresh), 1);
  assert.ok(!fresh.includes("## Watch the board"));
  // Someone has, and the agent hasn't replied yet: no task carries it, so it's under the steps.
  const waiting = markdown(await setup(fake({ deps: { messages: async () => [message("12", "ada")] } }).deps), INSPECT);
  assert.equal(count(waiting), 1);
  assert.ok(waiting.includes("## Watch the board"));
});

test("as markdown, an open deployment says only how to protect it", async () => {
  const { deps } = fake({ routes: { "https://factory.acme.dev/icon.svg": () => new Response("<svg/>", { status: 200 }) } });
  assert.equal(
    markdown(await setup(deps), INSPECT),
    `# Protect this deployment first

The setup shows once only your team can open this page.

- [ ] Turn on Vercel Authentication for all deployments
  [Open Deployment Protection](https://vercel.com/acme/factory/settings/deployment-protection)
`,
  );
});

test("the prompt for an agent names the deployment and the command that reads it: through protection on Vercel, plainly on a dev server", () => {
  const deployed = agentPrompt("https://factory.acme.dev", false);
  assert.ok(deployed.startsWith("Set up https://factory.acme.dev\n"));
  assert.ok(deployed.endsWith("vercel curl https://factory.acme.dev"));
  const local = agentPrompt("http://localhost:3000", true);
  assert.ok(local.endsWith(": curl http://localhost:3000"));
  assert.ok(!local.includes("vercel curl"));
});
