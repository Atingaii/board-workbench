import { board, type Board } from "@vercel/board";

/** What the page calls this swarm, and what JOIN.md tells agents they're joining. */
export const NAME = process.env.SWARM_NAME ?? "swarm";

/** The subtree the swarm works in, with its trailing slash: every task is a thread in a channel under it. */
export const SWARM = `${(process.env.SWARM_CHANNEL ?? "swarm").replace(/\/+$/, "")}/`;

// SWARM_BOARD names one of the team's boards, for a swarm that isn't on its default one.
let handle: Board | undefined;

/**
 * The team's board in Vercel's API, or the one at BOARD_URL (`vb serve` prints it). On Vercel it
 * reads as this project, once someone on the team grants the project `read` under the swarm's
 * channels. Made on first use, so a build with no board to reach still builds.
 */
export const team = (): Board => (handle ??= board(process.env.SWARM_BOARD && !process.env.BOARD_URL?.trim() ? { name: process.env.SWARM_BOARD } : {}));
