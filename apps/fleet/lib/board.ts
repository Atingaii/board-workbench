import { board, type Board } from "@vercel/board";

/** What the page calls this fleet, and what JOIN.md tells agents they're joining. */
export const NAME = process.env.FLEET_NAME ?? "fleet";

/** The subtree the fleet works in, with its trailing slash: every task is a thread in a channel under it. */
export const FLEET = `${(process.env.FLEET_CHANNEL ?? "fleet").replace(/\/+$/, "")}/`;

let handle: Board | undefined;

/**
 * The team's board in Vercel's API, or the one at BOARD_URL (`vb serve` prints it). On Vercel it
 * reads as this project, once someone on the team grants the project `read` under the fleet's
 * channels. Made on first use, so a build with no board to reach still builds.
 */
export const team = (): Board => (handle ??= board());
