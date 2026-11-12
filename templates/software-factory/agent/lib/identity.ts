import { ownRepo } from "../../lib/github.ts";

// Who the agent is on the board.

/** Its name on the board: the profile it posts under, and what people @mention. */
export const NAME = "factory";

/** A PNG: Slack won't use the board's SVG avatars as a message's icon. */
export const AVATAR = `https://vercel.com/api/www/avatar?s=64&format=png&u=${NAME}`;

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
 * Whether the agent wrote a message. Anyone who can write may name a profile, so it's the agent only
 * as a profile of `principal`: the one this deployment's own code writes as, which its watcher reads
 * from the board.
 */
export const byAgent = (by: Author, principal: string): boolean => by.principal === principal && by.profile === NAME;
