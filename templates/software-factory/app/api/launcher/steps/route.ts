import { boardName, connectors, factory, repoChannels, slackChannels } from "@/app/api/board/[[...path]]/factory";
import { boardDeps, isDone, liveDeps, setup } from "@/lib/setup";

// The setup page's steps, checked now, for the agent's setup_steps tool: the page's own tasks, so
// the agent never guesses at them.

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const deps = await liveDeps(boardDeps(factory), { connectors, repoChannels, slackChannels, board: boardName });
  deps.host = new URL(request.url).host;
  const result = await setup(deps);
  // As on the page: nothing about the factory while anyone can ask.
  if (result.open) return Response.json({ error: { code: "forbidden", message: "the setup checks are off until this deployment is protected" } }, { status: 403 });
  return Response.json(result.steps.map((step) => ({ title: step.title, optional: step.optional ?? false, done: isDone(step), tasks: step.tasks })));
}
