import { board } from "@vercel/board";
import { github, repos } from "@vercel/board/sync-github";
import { channels, slack } from "@vercel/board/sync-slack";
import { wakeAgent } from "../../../../agent/lib/wake.ts";
import { ownRepo } from "../../../../lib/github.ts";
import { appLogin, withoutForksOrOwn } from "./github.ts";

// The factory's board: your team's board in Vercel's API, which keeps its messages, files, and
// schedules. This deployment keeps nothing: it runs the board's sync and its watchers.

const own = ownRepo();

/** This factory's Vercel Connect connectors. */
export const connectors = { github: "github/factory", slack: "slack/factory" };

/** Each repo (`owner/name`, as GitHub writes it) and the board channel its PRs and issues come into. */
export const repoChannels: Record<string, string> = {
  ...(own ? { [own]: "dev/factory" } : {}),
  // "acme/web": "dev",
};

/** Each Slack channel (a name or an ID) and the board channel it mirrors, both ways. */
export const slackChannels: Record<string, string> = { "#factory": "dev" };

/** Production is on the team's default board. Anything else, your dev server included, is on one of its own, so it never answers production's threads. */
export const boardName = process.env.VERCEL_ENV === "production" ? null : "factory-dev";

export const factory = board({
  ...(boardName ? { name: boardName } : {}),
  basePath: "/api/board",
  sync: {
    // Nothing goes back to GitHub: the agent comments there itself, with gh.
    github: github(connectors.github, repos(withoutForksOrOwn(repoChannels, appLogin(connectors.github)))),
    // join: vb sources slack join <channel> adds the app to a public channel when someone asks.
    slack: slack({ adapter: connectors.slack, join: true }, channels(slackChannels)),
  },
  watch: {
    // Every message in dev and the channels under it, with GitHub access to the repos above. Not
    // named for the agent: a watcher writes as a profile named for its ID, and the board never
    // wakes a watcher for its own writes, so the agent's check-ins would never reach it.
    wake: { tail: "dev/", run: (context) => wakeAgent(context, { github: connectors.github, repos: Object.keys(repoChannels) }) },
  },
});
