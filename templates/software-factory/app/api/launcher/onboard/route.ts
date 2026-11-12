import { agentBoard } from "@/agent/lib/vb-tool";
import { WATCHER } from "@/agent/lib/identity";
import { sendToAgent } from "@/agent/lib/wake";
import { factory, repoChannels } from "@/app/api/board/[[...path]]/factory";
import { ownRequest } from "@/lib/first-task";
import { check } from "@/lib/launcher";
import { onboarded, repoName, startOnboarding } from "@/lib/onboard";
import { channel } from "@/lib/project";

// Asks the factory to onboard a repo, with `{ "repo": "<owner>/<repo>" }`: the page's Onboard
// button posts here, and so can an agent. The factory opens a thread where it changes itself, and
// its agent opens the pull request.

export const dynamic = "force-dynamic";
// The wake-up is tried 3 times, 30 seconds each at most, and says so in the thread when it never gets there.
export const maxDuration = 300;

const refuse = (message: string) => Response.json({ error: { code: "forbidden", message } }, { status: 403 });

export async function POST(request: Request): Promise<Response> {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (!ownRequest(request.headers.get("origin"), host)) return refuse("only this deployment's own page asks it to onboard a repo");
  const asked = (await request.json().catch(() => null)) as { repo?: unknown } | null;
  const repo = repoName(asked?.repo);
  if (!repo) return Response.json({ error: { code: "bad_repo", message: "name a repo as GitHub writes it: owner/repo" } }, { status: 400 });
  const { result } = await check(host);
  // As on the page: nothing about the factory, and nothing from it, while anyone can ask.
  if (result.open) return refuse("onboarding is off until this deployment is protected");
  // Already in: say where, from the map the page shows.
  const mapped = onboarded(repo, repoChannels);
  if (mapped) return Response.json({ started: false, repo: mapped, channel: repoChannels[mapped] });
  // A wake-up that never gets there is said in the thread, as the watcher says it.
  const root = await startOnboarding(agentBoard(factory), channel("rsi"), repo, (message) => sendToAgent(factory.as(WATCHER), message));
  return Response.json({ started: true, repo, thread: root.id });
}
