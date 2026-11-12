import { board } from "@vercel/board";
import { github, repos } from "@vercel/board/sync-github";
import { channels, slack } from "@vercel/board/sync-slack";
import { wakeAgent } from "../../../../agent/lib/wake.ts";
import { projectName } from "../../../../lib/project.ts";
import { repoChannels, slackChannels } from "./channels.ts";
import { appLogin, withoutForksOrOwn } from "./github.ts";

// The factory's board: your team's board in Vercel's API, which keeps its messages, files, and
// schedules. This deployment keeps nothing: it runs the board's sync and its watchers.

/** Which repos and Slack channels come in, and where: channels.ts is the file to edit. */
export { repoChannels, slackChannels };

/** This factory's Vercel Connect connectors, named for its Vercel project: a team has one connector per name. */
export const connectors = { github: `github/${projectName()}`, slack: `slack/${projectName()}` };

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
    // Every message in dev and the channels under it. A watcher writes as a profile named for its
    // ID, and the agent as the deployment itself: the board never wakes a watcher for its own
    // writes, so this way the agent's check-ins reach it.
    wake: { tail: "dev/", run: (context) => wakeAgent(context) },
  },
});
