import { ownRepo } from "../../../../lib/github.ts";
import { slackChannel } from "../../../../lib/project.ts";

// Which repos and Slack channels come into the board, and where. This is the file to edit.

const own = ownRepo();

/** Each repo (`owner/name`, as GitHub writes it) and the board channel its PRs and issues come into. */
export const repoChannels: Record<string, string> = {
  // This factory's own repo: where it changes itself.
  ...(own ? { [own]: "dev/factory" } : {}),
  // "acme/web": "dev",
};

/** Each Slack channel (a name or an ID) and the board channel it mirrors, both ways. */
export const slackChannels: Record<string, string> = {
  // Where the factory updates itself: its own PRs and issues, and talk about how it works. Named
  // for this factory's Vercel project, #factory-rsi for one named factory.
  [slackChannel("-rsi")]: "dev/factory",
  // "#dev": "dev",
};
