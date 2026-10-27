// Pi's OIDC tokens (AI Gateway's, and the board's, exchanged from it) die when the function's own does. Vercel
// reuses a function's token for up to 90 minutes of its 2 hours, so a turn can start with tokens that have 30
// minutes left. The eve agent puts new ones in its sandbox's policy before they die (`agent/lib/credentials.ts`).

/** How long before Pi's tokens die they're replaced: in their last 30 minutes, when functions get a new one. */
export const REFRESH_LEAD_MS = 15 * 60_000;

/** When a JWT expires, in epoch milliseconds. */
export function expiresAt(jwt: string) {
  return JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()).exp * 1000;
}

/** Whether a sandbox that has tokens until `until` for thread `had` needs new ones for `thread` at `now`. */
export const stale = (until: number, had: string, thread: string, now: number) =>
  had !== thread || until - REFRESH_LEAD_MS <= now;
