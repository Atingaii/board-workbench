import assert from "node:assert/strict";
import { test } from "node:test";
import { isDone, setup, type Deps, type Fix, type Step } from "../lib/setup.ts";

// The launcher's checks, driven as the page drives them, against a fake network: what a person sees is
// each step's checks, done or with what to do, and what the outside world sees is the requests it sends.

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


const message = (id: string, profile: string | null, re: string | null = null) =>
  ({ id, re, by: { principal: "p", profile, actor: "a" }, createdAt: "2026-11-03T00:00:00.000Z" }) as never;

function fake(options: { env?: Record<string, string | undefined>; routes?: Routes; deps?: Partial<Deps> } = {}) {
  const requests: string[] = [];
  const routes = { ...ROUTES, ...options.routes };
  const deps: Deps = {
    env: options.env ?? PRODUCTION,
    // As the board route configures it, on a deployment of acme/factory.
    synced: {
      connectors: { github: "github/factory", slack: "slack/factory" },
      repoChannels: { "acme/factory": "dev/factory" },
      slackChannels: { "#factory-rsi": "dev/factory" },
      board: null,
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
    access: async () => ({ "*": ["read", "post", "react", "label", "sync"] }),
    messages: async () => [message("12", null), message("13", "factory", "12")],
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
async function onlyProtect(deps: Deps): Promise<Fix> {
  const result = await setup(deps);
  assert.equal(result.open, true, "the launcher should show only how to protect the deployment");
  return (result as { fix: Fix }).fix;
}
const done = (steps: Record<string, Step>) => Object.fromEntries(Object.entries(steps).map(([id, step]) => [id, isDone(step)]));
const todo = (step: Step) => step.checks.filter((check) => !check.done);
const labels = (step: Step) => step.checks.map((check) => check.label);
const commands = (step: Step) => todo(step).flatMap((check) => check.fix?.commands ?? []);
const links = (step: Step) => todo(step).flatMap((check) => (check.fix?.link ? [check.fix.link.href] : []));

test("a factory that's set up passes every step but Slack, which stays optional", async () => {
  const steps = await shown(fake().deps);
  assert.deepEqual(done(steps), { vercel: true, github: true, slack: false, try: true });
  assert.equal(steps.slack!.optional, true);
});

test("it asks for no secret to get through its own protection, and shows no balance", async () => {
  const { vercel } = await shown(fake({ deps: { credits: async () => 16.44 } }).deps);
  assert.deepEqual(labels(vercel!), [
    "Deployment Protection is on.",
    "This project can use the team's board.",
    "It can sync GitHub and Slack with the board.",
    "AI Gateway has credits.",
  ]);
});

test("GitHub names the repos the app is on that come into no channel", async () => {
  // The app is on acme/factory, which comes into dev/factory on its own, and acme/web, which no one mapped.
  const { github } = await shown(fake().deps);
  assert.equal(isDone(github!), true);
  assert.ok(labels(github!).includes("Its app is on 2 repos. acme/web isn't in repoChannels, so its PRs and issues stay off the board."));
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
  assert.deepEqual(todo(github!).map((check) => [check.label, check.fix?.text]), [
    ["The app can't write to acme/factory.", "Give the app write access to acme/factory, so the agent can change its own code."],
  ]);
  assert.deepEqual(links(github!), ["https://github.com/apps/acme-factory/installations/new"]);
});

test("GitHub says nothing more when every repo the app is on comes in", async () => {
  const { github } = await shown(
    fake({ routes: { "https://api.github.com/installation/repositories": () => json({ total_count: 1, repositories: [{ full_name: "acme/factory" }] }) } }).deps,
  );
  assert.ok(labels(github!).includes("Its app is on 1 repo."));
});

test("an open production shows only how to protect it, and asks nothing of GitHub or the board", async () => {
  let read = false;
  const { deps, requests } = fake({
    routes: { "https://factory.acme.dev/icon.svg": () => new Response("<svg/>", { status: 200 }) },
    deps: { messages: async () => ((read = true), []), access: async () => ((read = true), {}) },
  });
  const fix = await onlyProtect(deps);
  assert.equal(fix.link?.href, "https://vercel.com/acme/factory/settings/deployment-protection");
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
  const fix = await onlyProtect(deps);
  assert.match(fix.text, /Couldn't check that this deployment is protected/);
  assert.deepEqual(requests, ["https://unreachable.acme.dev/icon.svg"]);
});

test("a team whose board nobody has opened yet is told to open it once, with the command that does", async () => {
  // What board() throws for a project the API names no board to: a team has one once a person has used it.
  const refused = Object.assign(new Error("this project has no access to the team's board (prj_factory, production)."), { code: "board_not_granted" });
  const { vercel, try: tryIt } = await shown(fake({ deps: { access: () => Promise.reject(refused) } }).deps);
  assert.deepEqual(todo(vercel!).map((check) => check.label), ["This project can't use the team's board yet."]);
  assert.deepEqual(commands(vercel!), ["npx @vercel/board inspect --scope acme"]);
  // Try it waits on the board, and says so in its own words, not the board's.
  assert.equal(todo(tryIt!)[0]?.fix?.text, "The board comes first: see Vercel, above.");
});

test("a board that can't be reached for another reason says what it answered", async () => {
  const { vercel } = await shown(fake({ deps: { access: () => Promise.reject(new Error("Vercel's API answered 503")) } }).deps);
  assert.equal(todo(vercel!)[0]?.fix?.text, "Couldn't reach the board: Vercel's API answered 503");
});

test("a project the board's grants don't let sync isn't ready, and is told who can let it, with no grant of the launcher's own", async () => {
  const { vercel } = await shown(fake({ deps: { access: async () => ({ "*": ["read", "post", "react", "label"] }) } }).deps);
  assert.deepEqual(todo(vercel!).map((check) => [check.label, check.fix?.text]), [
    ["It can't sync GitHub and Slack with the board.", "The board's grants were narrowed. Someone who manages the board can let this project sync."],
  ]);
  assert.deepEqual(commands(vercel!), []);
});

test("sync in one channel pattern is enough for the Vercel step", async () => {
  const { vercel } = await shown(fake({ deps: { access: async () => ({ "*": ["read"], "dev/": ["read", "post", "sync"] }) } }).deps);
  assert.equal(isDone(vercel!), true);
});

test("a GitHub connector that isn't attached says how to create and attach it, a command per box", async () => {
  const { github } = await shown(fake({ deps: { connect: async () => Promise.reject(new Error("connector not found")) } }).deps);
  assert.equal(isDone(github!), false);
  assert.deepEqual(commands(github!), [
    "vercel connect create github --name factory --triggers --trigger-project factory --trigger-path /api/board/webhooks/github --scope acme",
  ]);
});

test("GitHub isn't done until the app is on the factory's own repo", async () => {
  const { github } = await shown(
    fake({
      routes: { "https://api.github.com/installation/repositories": () => json({ total_count: 1, repositories: [{ full_name: "acme/web" }] }) },
    }).deps,
  );
  assert.deepEqual(todo(github!).map((check) => check.label), ["The app isn't on acme/factory."]);
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
  assert.deepEqual(todo(slack!).map((check) => check.label), ["There's no Slack connector for this project yet.", "Its app isn't in #factory-rsi yet."]);
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
  assert.deepEqual(todo(steps.slack!).map((check) => check.label), ["Its app isn't in #factory-rsi yet."]);
  assert.deepEqual(commands(steps.slack!), ["/invite @factory"]);
  // It says what the channel is for, and links to where another one is named, in this factory's own repo.
  assert.match(todo(steps.slack!)[0]!.fix!.text, /where the factory updates itself/);
  assert.deepEqual(links(steps.slack!), ["https://github.com/acme/factory/blob/main/app/api/board/%5B%5B...path%5D%5D/channels.ts"]);
  assert.ok(requests.includes("https://slack.com/api/auth.test"));
  assert.deepEqual(Object.values(steps).filter((step) => !step.optional && !isDone(step)), []);
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

test("try isn't done until someone has posted and the agent has replied", async () => {
  const nothing = await shown(fake({ deps: { messages: async () => [] } }).deps);
  assert.deepEqual(todo(nothing.try!).map((check) => check.label), ["Nobody has posted yet.", "The agent hasn't replied yet."]);
  const unanswered = await shown(fake({ deps: { messages: async () => [message("12", null)] } }).deps);
  assert.deepEqual(todo(unanswered.try!).map((check) => check.label), ["The agent hasn't replied yet."]);
});

test("try says how to open the board in its own step, on this team and by the board's name, so the agent's tool has it too", async () => {
  const waiting = fake({ deps: { messages: async () => [] } });
  assert.deepEqual(commands((await shown(waiting.deps)).try!), ["npx @vercel/board inspect --scope acme"]);
  const named = fake({ deps: { messages: async () => [] } });
  named.deps.synced.board = "factory-dev";
  assert.deepEqual(commands((await shown(named.deps)).try!), ["npx @vercel/board inspect --scope acme --name factory-dev"]);
});

test("locally, nothing asks whether the deployment is protected, and signing in is one link and one pull", async () => {
  const { deps, requests } = fake({
    env: { PORT: "3000" },
    deps: {
      oidc: async () => Promise.reject(new Error("no token")),
      credits: async () => Promise.reject(new Error("no token")),
      access: async () => Promise.reject(new Error("no team to find a board for")),
      connect: async () => Promise.reject(new Error("The 'x-vercel-oidc-token' header is missing")),
    },
  });
  const { vercel, github } = await shown(deps);
  assert.equal(isDone(vercel!), false);
  assert.deepEqual([...new Set(commands(vercel!))], ["vercel link", "vercel env pull"]);
  assert.deepEqual(commands(github!), ["vercel link", "vercel env pull"]);
  assert.ok(!requests.some((url) => url.includes("icon.svg")));
});

test("AI Gateway without credits says where to add them", async () => {
  const { vercel } = await shown(fake({ deps: { credits: async () => 0 } }).deps);
  assert.deepEqual(todo(vercel!).map((check) => check.label), ["AI Gateway is out of credits."]);
  assert.deepEqual(links(vercel!), ["https://vercel.com/acme/~/ai"]);
});

test("a team billed for AI Gateway usage, with a negative balance, is ready", async () => {
  const { vercel } = await shown(fake({ deps: { credits: async () => -1194239.37 } }).deps);
  assert.equal(isDone(vercel!), true);
});
