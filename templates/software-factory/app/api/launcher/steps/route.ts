import { repoChannels, slackChannels } from "@/app/api/board/[[...path]]/factory";
import { check } from "@/lib/launcher";
import { stepsView } from "@/lib/setup";

// The setup page's steps, checked now, for the agent's setup_steps tool: the page's own tasks, so
// the agent never guesses at them, and the factory's repos as this deployment sees them.

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const { result } = await check(new URL(request.url).host);
  // As on the page: nothing about the factory while anyone can ask.
  if (result.open) return Response.json({ error: { code: "forbidden", message: "the setup checks are off until this deployment is protected" } }, { status: 403 });
  return Response.json(stepsView(result, { repoChannels, slackChannels }));
}
