import { ownRepo } from "../../lib/github.ts";
import { projectName } from "../../lib/project.ts";

// Who the agent is on the board: this deployment, writing as itself. It has no profile of its own,
// so the board, and Slack, show it by its Vercel project's name and not as a name "via" that project.

/** Its name on the board, and what people @mention: the Vercel project's. */
export const NAME = projectName();

/** This factory's own repo, which it changes when it's asked to improve itself. */
export const OWN_REPO = ownRepo();

/** This deployment's own origin: its URL on Vercel, the dev server's locally. Not `PORT` under eve, whose dev process has its own. */
export const ORIGIN = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${process.env.PORT ?? 3000}`;

/**
 * This deployment's OIDC token on Vercel, and none on your machine. It's what the deployment calls
 * itself with: Deployment Protection's Trusted Sources let a project reach its own environment with
 * it, in `x-vercel-trusted-oidc-idp-token`, and no other.
 */
export const ownToken = async (): Promise<string | null> => (process.env.VERCEL_URL ? (await import("@vercel/oidc")).getVercelOidcToken() : null);

type Author = { principal: string; profile: string | null };

/**
 * Whether the agent wrote a message: this deployment (`principal`, which its watcher reads from the
 * board), with no profile. What else the deployment writes has one: its watcher's own replies, named
 * for the watcher, and what its sync brings in from GitHub and Slack, named for who wrote it there.
 */
export const byAgent = (by: Author, principal: string): boolean => by.principal === principal && by.profile === null;
