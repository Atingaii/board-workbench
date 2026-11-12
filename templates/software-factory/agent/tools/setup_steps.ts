import { defineTool } from "eve/tools";
import { z } from "zod";
import { ORIGIN, ownToken } from "../lib/identity.ts";

export default defineTool({
  description:
    "The factory's setup, checked now: each step the setup page shows (Vercel, GitHub, Slack, Try it), whether it's done, what was found, and what to do, with the exact commands. Use it whenever someone asks about setting the factory up, and quote its commands as they are.",
  inputSchema: z.object({}),
  async execute() {
    // This deployment's own setup page, which runs the checks. Its OIDC token gets the call through
    // Deployment Protection, which trusts a project's calls to its own environment.
    const token = await ownToken();
    const response = await fetch(`${ORIGIN}/api/launcher/steps`, {
      headers: token ? { "x-vercel-trusted-oidc-idp-token": token } : {},
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    return response.ok ? body : `The setup page's checks answered ${response.status}: ${body.slice(0, 300)}`;
  },
});
