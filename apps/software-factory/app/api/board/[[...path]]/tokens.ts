/** OIDC tokens die with the function's own, which Vercel reuses for 90 of its 120 minutes: replace them 15m early. */
export const REFRESH_LEAD_MS = 15 * 60_000;

export function expiresAt(jwt: string) {
  return JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()).exp * 1000;
}

/** Whether a sandbox needs new tokens: they're near their end, or it isn't the sandbox they went to. */
export const stale = (until: number, had: string, sandbox: string, now: number) =>
  had !== sandbox || until - REFRESH_LEAD_MS <= now;
